---
title: 使用Rust编写用户态驱动程序
date: 2018-08-19 22:06:46
tags:
---


## 概览


在云计算技术的发展史上，如何提高单个服务器的并发度，一直是热门的研究课题。在20年前，就有著名的“[C10K][C10K]”问题，即如何利用单个服务器每秒应对10K个客户端的同时访问。这么多年大量的实践证明，异步处理和基于事件（即epoll，kqueue和iocp）的响应方式成为处理这类问题的事实上标准方法。


不过，人类的追求是永无至今的。15年后，当摩尔定律在硬件上的理论提升有1000倍时，有人对并发数量提出了更高的要求，"C10K"升级为"[C10M][C10M]"问题，即每秒应对10M个客户端的同时访问。咋眼一看，怎么会有这样的服务，需要每秒处理上千万的并发？实际上这样的需求是广泛存在的，典型的例子就是DNS服务器、网络授时服务以及基于内存的key-value服务器。这种服务的特点是，一次客户请求涉及的计算量可能会很少，大部分时间均花在了IO上。所以根据[Amdahl定律][amdahl-law]，优化的重点需放在如何减少I/O路径上的开销。


最早提出"C10M"问题的Robert Graham认为，减少开销的关键之一在于绕过操作系统，即"kernel bypass"，因为我们使用的操作系统在设计之初并没有考虑高并发的场景，而I/O路径上的大部分例程又在内核空间中，大量无谓的消耗花在了内核空间和用户空间上下文的切换上。解决的方法就是将I/O路径（对于网络请求来讲，就是驱动和网络协议栈）全部实现在用户空间，这样可以最大程度的减少内核的干预，并且通过轮询(polling)而不是硬件中断的方法来获取网卡上的请求（而对于存储器来讲，就是complete信息）。再结合其他优化方法，例如协程和零拷贝技术，可以将并发性能优化到极致，具体请见[“内核才是问题的根本”][C10M-translation]。


基于这样的背景，一种未来的趋势是出更多的硬件驱动将在用户空间中实现，而这种趋势似乎正在慢慢成为现实。例如Intel的DPDK相关的技术，以及RDMA和XDP，都是此类思路的具体实践。在本文中，我们将尝试用[Rust][rust-zh_CN]语言来实现一个极其简单的Intel ixgbe 10G网络控制器驱动，并在编写测试程序测试其基础性能。


需要特别说明的是，本文的目的之一是探寻Rust语言编写驱动的优缺点，所以对于具体的网络接口的硬件细节关注较少，所以实现基本上是在[C语言版本的驱动emmericp/ixy][upstream-code]的基础上进行Rust移植。本文的相关代码请移步[Github仓库][code]。


## 为什么用Rust？

Rust是一款能够保证安全和较高性能的静态编译型语言，其目标在于取代C，成为系统软件的主要实现语言。Rust充分利用了LLVM等最新的编译优化和静态分析技术，能够将**安全和性能**，这两个看似矛盾的目标很好的结合在一起，而我认为**这正是驱动程序所不断追求的两个目标**。几乎所有的安全检查都是在编译的过程中通过静态分析加以解决，如有违反，则编译立刻停止返回失败，因此避免了运行时的额外开销。Rust提供如下三个方面的安全性：

* 内存安全：Rust具有完整的内存生命周期检查，保证了一块区域的内存不会在其生命周期之外被引用，同时引入了所有权和`borrow`机制，使得变量要么处于共享只读，要么处于互斥写状态。另外，Rust也不允许空指针和悬空指针，所有变量需经过初始化才能使用；
* 类型安全：Rust是强类型语言，任何形式的类型转换都需要开发者进行显式的实现；
* 并发安全：因为Rust的所有权机制，使得变量和内存能够在多个线程之间进行传递和共享，而不用担心数据竞争的问题。

不过要指出的是，Rust为了能够与C中的函数进行互操作，以及更好地进行其他“非安全”的操作（例如指针运算，裸指针的解引用等），提供了`unsafe`关键字进行支持，同时也在代码中显式地指出这个地方可能会出现安全性问题。

## 驱动实现

对于高性能计算中，通常的一种内存使用的优化方法是使用页面大小为2MB或1GB的巨页（hugepage），其好处在于：
* 减少缺页中断的次数，减少前文中提到内核空间和用户空间的上下文切换带来的开销；
* AMD64位处理器上的hugepage页表只有2-3层，可以减少MMU巡表时间，同时也能减少页表项的个数，便于TLB的缓存。

对于ixgbe驱动，同样也需要hugepage的支持。不过在Linux下，需要手动通过写sys文件系统进行开启，例如：
```
mkdir -p /mnt/huge
mount -t hugetlbfs hugetlbfs /mnt/huge
echo 512 > /sys/devices/system/node/node0/hugepages/hugepages-2048kB/nr_hugepages
```

### 关键数据结构

#### `DeviceInfo`
对于大多数的NIC网卡来讲，需要不同的方式来分别处理流入(receive, RX)和流出(transport, TX)的流量。而为了增加数据的并行度，对于高速网卡而言，通常每种模式可以设置多个队列（例如64）以流水线的方式存储数据，因此顶层的数据结构`DeviceInfo`包含这两种模式的不同队列：

```rust
pub struct DeviceInfo {
    num_rx_queues: u32,
    num_tx_queues: u32,
    rx_queues: Vec<RxQueue>,
    tx_queues: Vec<TxQueue>,
    addr: *mut u8,
}
```

`addr`中存放的是网卡信息在内存中的映射地址，需要通过libc中的mmap操作获取得到。而在mmap操作之前，需要先知道到网卡在内核中的文件的句柄fd值，一种比较标准的做法是通过sys文件系统去读取对于pci地址上的设备信息：

```
let file = open(format!("/sys/bus/pci/devices/{}/resource0", pci_addr));
let addr = libc::mmap(..., file.as_raw_fd(), ...); 
```

#### `RxQueue`和`TxQueue`

`RxQueue`和`TxQueue`结构体的定义分别如下：
```rust
struct RxQueue {
    descriptors: *const u8,
    mempool: RefCell<Mempool>,
    num_entries: u16,
    // position we are reading from
    rx_index: u16,
    // virtual addresses to map descriptors back to their mbuf for freeing
    virtual_addresses: Vec<*mut Buffer>,
}

struct TxQueue {
    descriptors: *const u8,
    num_entries: u16,
    // position to clean up descriptors that where sent out by the nic
    clean_index: u16,
    // position to insert packets for transmission
    tx_index: u16,
    // virtual addresses to map descriptors back to their mbuf for freeing
    virtual_addresses: Vec<*mut Buffer>,
}
```
对`RxQueue`而言：
* `descriptors`：分配的DMA内存的起始地址，
* `mempool`：全局内存池的地址
* `num_entries`：RX中队列数量
* `rx_index`: 当前处理的队列序号
* `virtual_address`：队列集合

同样地，对于`TxQueue`也有相似的数据项。

#### `Buffer`和`Mempool`

为了能够很好地管理DMA内存，对于通过hugepage申请到的内存页面，我们通过`Mempool`数据结构进行管理，其内部的结构非常简单，并且对外有明确的结构，即分配(alloc)和回收(free)网卡数据包内存。

```rust
pub struct Mempool {
    free_stack: Vec<*mut Buffer>,
    free_stack_top: u32,
}

impl Mempool {
    pub fn alloc_buf(&mut self) -> Option<*mut Buffer>;
    pub fn free_buf(&mut self, buf: *mut Buffer);
}
```

从网卡流入和流出的数据包，以及存放数据的具体位置，在`Buffer`结构体中定义：

```rust
#[repr(C)]
pub struct Buffer {
    // physical address to pass a buffer to a nic
    buf_addr_phys: usize,
    pub mempool: *mut Mempool,
    idx: u32,
    pub size: u32,
    head_room: [u8; SIZE_PKT_BUF_HEADROOM as usize],
}
```

#### 其他数据结构

Stat统计RX和TX分别处理了多少个数据包和相应的字节数。
```rust

pub struct Stats {
    rx_pkts: u32,
    tx_pkts: u32,
    rx_bytes: u64,
    tx_bytes: u64,
}
```
另外，还有一些数据结构，主要是封装了硬件相关的数据，举个例子：
```rust
#[repr(C)]
#[derive(Clone, Copy)]
union AdvTxDesc {
    read: TxAddr,
    wb: TxWriteback,
}
```
这里，`read`和`wb`分别表示同一块内存地址在不同模式下，具有不同的状态信息。所以这里我们使用了union结构。

### 使用宏（Macro）简化底层操作

硬件驱动的另一个主要职责是，以合乎硬件手册的规范的方式来操纵寄存器和内存映射地址，而它需要大量的繁琐的代码。在C语言中，通常使用`#define`来定义这些宏，例如：

```C
/*
* Split and Replication Receive Control Registers
* 00-15 : 0x02100 + n*4
* 16-64 : 0x01014 + n*0x40
* 64-127: 0x0D014 + (n-64)*0x40
*/
#define IXGBE_SRRCTL(_i)	(((_i) <= 15) ? (0x02100 + ((_i) * 4)) : \
				 (((_i) < 64) ? (0x01014 + ((_i) * 0x40)) : \
				 (0x0D014 + (((_i) - 64) * 0x40))))
```


而在Rust语言中，宏的定义也有相应的方式，即关键字`macro_rules`，所以上面的内存地址的访问，在Rust中等价的表达如下：

```rust
macro_rules! IXGBE_SRRCTL {
    ($_i:expr) => {
        match ($_i) <= 15 {
            true => (0x02100 + (($_i) * 4)),
            false => match ($_i) < 64 {
                true => (0x01014 + (($_i) * 0x40)),
                false => (0x0D014 + ((($_i) - 64) * 0x40)),
            },
        }
    };
}
```

另外，相对于C，Rust中定义宏还有个好处是，它具有清晰的语义，所有传入宏里的表达式参数均是[先`eval`之后再参与计算][macro-example]，避免了诸如C中的下列歧义问题，所以建议大家多使用Rust中的宏来简化和更清晰地表达。

```C
#define test(i) i * 2
test(1 + 1)
```

## 性能测试和总结

按照仓库中的[文档](https://github.com/zhangpf/nic-drivers#build-and-run)进行编译并运行pktgen测试程序，代码基本上重现了[ixy][upstream-code]的实验结果。

在我的实验机器（2* Xeon E5-2640 + 64GB mem + Intel 82599ES网卡）上，`pktgen`运行的结果如下所示：
```
virt: 7fccda600000, phys: 816400000
No driver loaded
Resetting device 0000:01:00.0
Initializing device 0000:01:00.0
initializing rx queue 0
virt: 7fccda400000, phys: 816800000
rx ring 0 phy addr:  816800000
rx ring 0 virt addr: 7FCCDA400000
virt: 7fccd9c00000, phys: 816e00000
initializing tx queue 0
virt: 7fccd9a00000, phys: 817000000
tx ring 0 phy addr:  817000000
tx ring 0 virt addr: 7FCCD9A00000
starting rx queue 0
starting queue 0
enabling promisc mode
Waiting for link...
Link speed is 10000 Mbit/s
RX: 0 Mbit/s 0 Mpps

TX: 9901.384292164801 Mbit/s 14.734186286261325 Mpps

RX: 0.0024058573361193836 Mbit/s 0.000001991603755065715 Mpps

TX: 9999.00754202517 Mbit/s 14.879477785084605 Mpps

RX: 0.0011392588353670422 Mbit/s 0.000000995855625320841 Mpps

TX: 9999.552267294279 Mbit/s 14.880286870792201 Mpps

RX: 0 Mbit/s 0 Mpps

TX: 9998.990842343424 Mbit/s 14.879450658249143 Mpps
```

由结果可以看出，TX基本上跑满10Gb的带宽，所以由Rust实现驱动在性能上能够和C不相上下。

但是，当前的实现中还有许多值得改进的地方，比如：

* 在Rust中，通常不应该有自己实现的内存分配器，更不应该有显式地的`free`类型的操作。不过因为我们使用了Hugepage来处理底层内存管理，所以这部分必须要自己实现，一种更优雅的做法是实现Rust中的[`alloc::alloc::Alloc`][alloc-trait]类型的trait，以及相应的函数实现，以便于与其它的库很好的兼容，实现内存的自动管理。

```rust
trait Alloc {
    unsafe fn alloc(&mut self, layout: Layout) -> Result<NonNull<u8>, AllocErr>;
    unsafe fn dealloc(&mut self, ptr: NonNull<u8>, layout: Layout);
}
```

* 代码中的有些地方并不符合Rust的风格，例如在`DeviceInfo`中，`rx_queues: Vec<RxQueue>`项已经包含了队列的长度信息，不应该再添加重复的`num_rx_queues: u32`。

以上问题在以后优化中将持续改进。

[rust-book]: https://doc.rust-lang.org/book/2018-edition/index.html
[alloc-trait]: https://doc.rust-lang.org/alloc/alloc/trait.Alloc.html
[code]: https://github.com/zhangpf/nic-drivers
[C10M-translation]: https://www.oschina.net/translate/the-secret-to-10-million-concurrent-connections-the-kernel?cmp&p=1
[upstream-code]: https://github.com/emmericp/ixy
[rust-zh_CN]: https://www.rust-lang.org/zh-CN/
[C10K]: http://www.kegel.com/c10k.html
[C10M]: http://c10m.robertgraham.com/p/manifesto.html
[macro-example]: https://bit.ly/2LgAAtD
[amdahl-law]: https://zh.wikipedia.org/wiki/%E9%98%BF%E5%A7%86%E8%BE%BE%E5%B0%94%E5%AE%9A%E5%BE%8B
