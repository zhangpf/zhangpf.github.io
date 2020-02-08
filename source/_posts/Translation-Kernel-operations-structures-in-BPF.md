---
title: 【译文】使用BPF控制内核的ops结构体
date: 2020-02-08 09:55:59
tags: [Linux, eBPF, ops结构, microkernel]
categories: 中文
---


<!-- One of the more eyebrow-raising features to go into the 5.6 kernel is the ability to load TCP congestion-control algorithms as BPF programs; networking developer Toke Høiland-Jørgensen described it as a continuation of the kernel's "march towards becoming BPF runtime-powered microkernel". On its face, congestion control is a significant new functionality to hand over to BPF, taking it far beyond its existing capabilities. When one looks closer, though, one's eyebrow altitude may well increase further; the implementation of this feature breaks new ground in a couple of areas. -->

Linux内核5.6版本的众多令人惊喜的功能之一是：TCP拥塞控制算法（congestion control algorithm）可作为用户空间的[BPF(Berkeley Packet Filter)](https://lwn.net/Articles/740157/)程序进行加载和执行。
网络开发者Toke Høiland-Jørgensen将这项功能[描述为](https://lwn.net/ml/bufferbloat/87bls8bnsm.fsf@toke.dk/)“**内核正向成为支持BPF运行时的微内核迈进(march towards becoming BPF runtime-powered microkernel)**”的延续性动作。
从外表上看，这是赋予给BPF的一项重要的新功能，使得拥塞控制将远远超过现有能力。
但当我们深入研究后发现，其令人惊喜之处远不止这些，因为该功能的实现在多个方面都取得了新的进展。

<!-- 
The use case for this feature seems clear enough. There are a number of such algorithms in use, each of which is suited for a different networking environment. There may be good reasons to distribute an updated or improved version of an algorithm and for recipients to be able to make use of it without building a new kernel or even rebooting. Networking developers can certainly benefit from being able to play with congestion-control code on the fly. One could argue that congestion control is not conceptually different from other tasks, such as flow dissection or IR protocol decoding, that can be done with BPF now — but congestion control does involve a rather higher level of complexity. -->

该功能的使用场景和用例似乎都比较明确，因为有大量不同的拥塞控制算法已在使用中，且每种算法都适合于不同的网络环境。
利用该功能，我们有充足方法来分发更新或改进后的控制算法，因为使用者能够在无需重新构建内核甚至无需重启的情况下使用新算法，使得网络功能开发者可从运行中的拥塞控制代码中获得好处。
有人可能会质疑，拥塞控制功能在概念上与BPF现有的其它功能（例如[flow dissection](https://lwn.net/Articles/764200/)或[Infrared协议解码](https://lwn.net/Articles/759188/)）没有本质的不同，但需要指出的是，拥塞控制确实涉及到相当高的复杂性。

<!-- A look at the patch set posted by Martin KaFai Lau reveals that what has been merged for 5.6 is not just a mechanism for hooking in TCP congestion-control algorithms; it is far more general than that. To be specific, this new infrastructure can be used to allow a BPF program to replace any "operations structure" — a structure full of function pointers — in the kernel. It is, at this point, only capable of replacing the tcp_congestion_ops structure used for congestion control; experience suggests, though, that other uses will show up sooner rather than later. -->

如果看一下Martin KaFai Lau发布的[patch集合](https://lwn.net/ml/netdev/20191231062037.280596-1-kafai@fb.com/)，你就会发现5.6版本内核将要合并的代码不仅仅是一项能够hook住TCP拥塞控制的机制，其真实威力远不止于此。
具体地说，这种新架构可用于允许BPF程序替换内核中的任何“ops结构(`struct xxx_ops`)”——一个由函数指针组成的结构。
目前，虽然它只能替换用于拥塞控制的[`struct tcp_congestion_ops`结构](https://elixir.bootlin.com/linux/v5.5/source/include/net/tcp.h#L1043)，但大量的经验表明，在内核其他地方的应用将很快涌现。

<!-- ## The user-space API -->
## 用户空间API
<!-- 
On the user-space side, loading a new operations structure requires a few steps, the first of which is to use the [`bpf()` system call](http://www.man7.org/linux/man-pages/man2/bpf.2.html) to load an implementation of each function as a separate BPF program. The new `BPF_PROG_TYPE_STRUCT_OPS` type has been defined for these programs. In the attributes passed with each program, user space must provide the BPF type format (BTF) ID corresponding to the structure being replaced (specifying the actual function being implemented comes later). BTF is a relatively recent addition that describes the functions and data structures in the running kernel; it is currently used for [type-checking of tracing functions](https://lwn.net/Articles/803258/) among other purposes. -->
在用户空间中，加载新的`ops`结构需要如下几个步骤。首先，使用[`bpf()`](http://www.man7.org/linux/man-pages/man2/bpf.2.html)系统调用以单独的BPF程序对每个函数的实现进行加载，这些BPF程序已经可以使用新的`BPF_PROG_TYPE_STRUCT_OPS`类型定义ops。
用户空间在每个程序提供的属性中，必须提供与要替换的结构相对应的BPF类型格式（BPF Type Format，BTF）的ID（同时用于指定稍后要实现的实际功能）。 
BTF是一项较新的特性，它描述了正在运行的内核中的函数和数据结构，目前用于[追踪函数的类型检查](https://lwn.net/Articles/803258/)。

<!-- User space must also specify an integer offset identifying the function this program will replace. For example, the ssthresh() member of `struct tcp_congestion_ops` is the sixth field defined there, so this offset will be passed as five (since offsets start at zero). How this API might interact with [structure layout randomization](https://lwn.net/Articles/722293/) is not entirely clear. -->

用户空间还必须指定一个整数偏移量，以标识此程序将要替换的函数。
例如，`struct tcp_congestion_ops`的函数指针字段`ssthresh()`在结构中位于第六个字段，因此将5作为偏移量进行传递（偏移量从0开始）。
目前还不明确该API如何与[结构布局随机化（structure layout randomization）](https://lwn.net/Articles/722293/)进行交互。

<!-- As the programs for each structure member are loaded, the kernel will return a file descriptor corresponding to each. Then, user space must populate a structure that looks like this: -->

在加载每个结构字段对应的程序时，内核将返回与每个结构字段相对应的文件描述符。为了使用此描述符，用户空间还必须填充如下的结构：

```c
struct bpf_tcp_congestion_ops {
    refcount_t refcnt;
    enum bpf_struct_ops_state state;
    struct tcp_congestion_ops data;
};
```
<!-- 
The `data` field has the type of the structure to be replaced — `struct tcp_congestion_ops` in this case. Rather than containing function pointers, though, this structure should contain the file descriptors for the programs that have been loaded to implement those functions. The non-function fields of that structure should be set as needed, though the kernel can override things as described below. 
-->
上面的代码中，`data`字段的类型是将要替换的结构——在拥塞控制中也就是`struct tcp_congestion_ops`，但是，此结构应包含已加载用于实现对应拥塞控制功能的程序的文件描述符，而非函数指针。
尽管内核可以按如下所述覆盖内容，但也应根据需要设置该结构中的非函数字段。

<!-- The last step is to load this structure into the kernel. One might imagine a number of ways of doing this; the actual implementation is almost certainly something else. User space must create a special BPF map with the new `BPF_MAP_TYPE_STRUCT_OPS` type. Associated with this map is the BTF type ID of a special structure in the kernel (described below); that is how the map is connected with the structure that is to be replaced. Actually replacing the structure is accomplished by storing the `bpf_tcp_congestion_ops` structure filled in above into element zero of the map. It is also possible to query the map (to see the reference-count and state fields) or to remove the structure by deleting element zero. -->

最后一步，是将该结构加载到内核中，有多种方式来达到该目的，因此实际的实现几乎可以肯定是另外的方式。
用户空间必须使用新添加的`BPF_MAP_TYPE_STRUCT_OPS`类型创建一个特殊的BPF映射，与该映射相关联的是内核中特殊结构的BTF类型ID（如下所述），这就是将映射与要替换的结构连接在一起的方式。
实际的结构替换是通过将上面的`bpf_tcp_congestion_ops`结构存储到零填充的映射中来完成的，此外还支持的操作包括：查询映射（以获取引用计数和状态字段）和通过删除元素0来删除结构。


<!-- BPF maps have grown in features and capability over the years. Even so, this seems likely to be the first place where map operations have this kind of side effect elsewhere in the kernel. It is arguably not the most elegant of interfaces; most user-space developers will never see most of it, though, since it is, like most of the BPF API, hidden behind a set of macros and magic object-file sections in the `libbpf` library. -->
近年来，BPF映射相关的功能和特性不断的出现，即便如此，这次添加的新功能似乎是映射操作首次在内核产生类似副作用的方法。
也许本功能不是最优雅的接口，但大多数用户空间的开发者将永远看不到它背后的大部分细节，因为它就像其他大多数BPF的API一样，隐藏在`libbpf`库中的一系列宏和对象的背后。


<!-- ## The kernel side -->
## 内核空间

<!-- 
Replacing an operations structure requires support in the kernel; there is no ability for user space to replace arbitrary structures at will. To make it possible to replace a specific type of structure, kernel code must create a structure like this: 
-->
由于用户空间无权限任意替换结构，所以替换ops结构需要内核的支持，为了支持这样的替换，内核态必须新添加如下结构：

```c
#define BPF_STRUCT_OPS_MAX_NR_MEMBERS 64
struct bpf_struct_ops {
    const struct bpf_verifier_ops *verifier_ops;
    int (*init)(struct btf *btf);
    int (*check_member)(const struct btf_type *t,
                        const struct btf_member *member);
    int (*init_member)(const struct btf_type *t,
                        const struct btf_member *member,
                        void *kdata, const void *udata);
    int (*reg)(void *kdata);
    void (*unreg)(void *kdata);
    const struct btf_type *type;
    const struct btf_type *value_type;
    const char *name;
    struct btf_func_model func_models[BPF_STRUCT_OPS_MAX_NR_MEMBERS];
    u32 type_id;
    u32 value_id;
};
```
<!-- There are more details here than can be easily covered in this article, and some of the fields of this structure are automatically filled in by macros. The `verifier_ops` structure has a number of functions used to verify that the individual replacement functions are safe to execute. There is a new field added to that structure in this patch set, `struct_access()`, which regulates which parts, if any, of the operations structure itself can be changed by BPF functions. -->
本文无法包含所有这些代码的细节，并且由于宏的存在，它自动填充此结构的某些字段。 
值得说明的是，`verifier_ops`结构中有多个函数，可用于验证各个替换功能是否可安全执行。
在即将合并的补丁集中，该结构中添加了一个新字段：`struct_access()`，其用于控制BPF函数可以更改ops结构本身的哪些部分（如果有的话）。

<!-- The `init()` function will be called first to do any needed global setup. `check_member()` determines whether a specific member of the target structure is allowed to be implemented in BPF, while `init_member()` verifies the exact value of any fields in that structure. In particular, `init_member()` can validate non-function fields (flags fields, for example). The `reg()` function actually registers the replacement structure after the checks have passed; in the congestion-control case, it will install the `tcp_congestion_ops` structure (with the appropriate BPF trampolines used for the function pointers) where the network stack will use it. `unreg()` undoes that action. -->
内核在获取到用户空间的请求后，首先调用`init()`函数，来进行一切所必需的全局设置。
`check_member()`函数决定是否允许目标结构的特定成员在BPF中实现，而`init_member()`则用于验证该结构中所有字段的确切值，特别地，`init_member()`可以验证非函数字段（例如flag字段）。 
在检查通过后，则通过`reg()`函数进行实际地注册替换结构，具体地，在拥塞控制的场景下，该函数将`tcp_congestion_ops`结构（和用于函数指针的BPF相关的trampoline）安装在网络栈中将要使用的位置。
相反地，`unreg()`则用于撤消操作。

<!-- One structure of this type should be created with a specific name: the type of the structure to be replaced with `bpf_` prepended. So the operations structure for the replacement of a `tcp_congestion_ops` structure is named [`bpf_tcp_congestion_ops`](https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git/tree/net/ipv4/bpf_tcp_ca.c#n241). This is the "special structure" that user space must reference (via its BTF ID) when loading a new operations structure. Finally, a line is added to `kernel/bpf/bpf_struct_ops_types.h`:     -->

这种类型的结构应使用特定名称创建，即添加`bpf_`前缀。
因此，用于替换`tcp_congestion_ops`结构的ops结构的名字为[`bpf_tcp_congestion_ops`](https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git/tree/net/ipv4/bpf_tcp_ca.c#n241)，
这是加载新的ops结构时用户空间必须（通过BTF的ID）引用的“特殊结构”。
最后，在`kernel/bpf/bpf_struct_ops_types.h`中添加如下的一行代码：

```c
BPF_STRUCT_OPS_TYPE(tcp_congestion_ops)
```

<!-- The lack of a trailing semicolon is necessary. By virtue of some macro magic and including this file four times into [`bpf_struct_ops.c`](https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git/tree/kernel/bpf/bpf_struct_ops.c), everything is set up without the need of a special function to register this structure type. -->
借助宏操作，以及将此文件四次include到[`bpf_struct_ops.c`](https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git/tree/kernel/bpf/bpf_struct_ops.c)中，便可处理好所有设置，而无需特殊的函数注册该结构类型。


<!-- ## In closing -->
## 总结

<!-- For the curious, the kernel-side implementation of `tcp_congestion_ops` replacement can be found in [`net/ipv4/bpf_tcp_ca.c`](https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git/tree/net/ipv4/bpf_tcp_ca.c). There are two actual algorithm implementations ([DCTCP](https://git.kernel.org/linus/09903869f69f) and [CUBIC](https://git.kernel.org/linus/6de4a9c430b5)) in the tree as well.

The ability to replace an arbitrary operations structure in the kernel potentially holds a lot of power; a huge portion of kernel code is invoked through at least one such structure. If one could replace all or part of the [`security_hook_heads` structure](https://elixir.bootlin.com/linux/v5.5/source/include/linux/lsm_hooks.h#L1831), one could modify security policies in arbitrary ways, similar to what is proposed with [KRSI](https://lwn.net/Articles/808048/), for example. Replacing a [`file_operations` structure](https://elixir.bootlin.com/linux/v5.5/source/include/linux/fs.h#L1821) could rewire just about any part of the kernel's I/O subsystem. And so on. -->

`tcp_congestion_ops`替换机制中内核态的实现可以在[`net/ipv4/bpf_tcp_ca.c`](https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git/tree/net/ipv4/bpf_tcp_ca.c)文件中找到，源码树中已有两种不同控制算法的实现（[DCTCP](https://git.kernel.org/linus/09903869f69f)和[CUBIC](https://git.kernel.org/linus/6de4a9c430b5)）。


可替换内核中任意ops结构是一项潜在的强大功能，因为内核中很大一部分代码是通过这种类型的结构调用的。
比如说，如果可以替换全部或部分[`security_hook_heads`结构](https://elixir.bootlin.com/linux/v5.5/source/include/linux/lsm_hooks.h#L1831)，则可以以任意方式修改安全策略，例如，实现类似于[KRSI](https://lwn.net/Articles/808048/)的功能。
还有，替换[`file_operations`结构](https://elixir.bootlin.com/linux/v5.5/source/include/linux/fs.h#L1821)几乎可以重写内核I/O子系统的任何部分。

<!-- 
Nobody is proposing to do any of these things — yet — but this sort of capability is sure to attract interested users. There could come a time when just about any kernel functionality is amenable to being hooked or replaced with BPF code from user space. In such a world, users will have a lot of power to change how their systems operate, but what we think of as a "Linux kernel" will become rather more amorphous, dependent on which code has been loaded from user space. The result is likely to be interesting. 
-->

目前还没有任何人提出类似的方法，但是这样的功能肯定会吸引感兴趣的开发者。
将来会有某个时刻，几乎任何内核功能都可以被用户空间的BPF代码hook或替换，
那时用户将拥有改变系统运行方式的强大能力，但是我们认为“Linux内核”将变得更加充满不确定性，这也取决于从用户空间加载了哪些代码。
结果可能会很有趣。

*(译者注：本文原地址为 https://lwn.net/Articles/811631/)*
