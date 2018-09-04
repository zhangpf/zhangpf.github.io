---
title: 使用Windows的UMS(User-Mode Scheduling)实现轻量级线程
date: 2018-08-27 21:04:23
tags: [云计算, 并发, Windows, UMS]
categories: 中文
---


前几天在看关于Rust取消M:N线程模型背后的理性选择时候，看到[Daniel Micay][thestinger]的一篇帖子中提到了Windows的UMS功能，了解之后s觉得有点意思。所以就花了几天研究一下，分析了它的优缺点和基本性能情况，于是总结成此文。

## 背景

[UMS (User-Mode Scheduling)][UMS]是微软在其Windows 7及其以后版本的64位操作系统中添加的一个功能，其目的是支持应用对申请的线程进行自定义管理，以此方式实现类似于轻量级线程的高效并发。

虽然在云计算领域，Linux成了事实上的基础操作系统平台，但没想到却是微软首先在其自家系统上实现了此功能，Google的开发者在Linux尝试了[类似的实现][linux-attempt]，不过据我所了解，到目前为止都尚未进入Linux的主分支。

我们都知道，根据用户空间和内核空间的映射关系不同，线程模型可以分为以下三种：

1. 1:1，即内核态线程：用户空间中的不同线程，分别对应到内核中的一个线程。所有的线程上下文都是由内核来管理，并且所有线程状态的改变，包括调度、I/O阻塞、page fault和信号事件等，都需要进行一次“上下文切换(context switch)”到内核空间中才能处理。Linux和Windows原生线程都是这种类型，它的优点是模型简单，而且能够透明地利用多核(multicore)进行并行处理，缺点是应对大规模的线程管理和并发乏力，因为大量的开销都花在了上下文切换上。
2. N:1，即用户态线程：用户空间中的多个线程，都对应于内核的用一上下文(context)，线程的切换不再需要进入到内核处理，可以直接由用户态的runtime进行管理，在多种编程语言（如Python，PHP等）中又称为“绿色线程(green thread)”。与内核态线程相反，这类线程的优点是可以支持大量并发，但是却没法直接扩展到多核上进行处理。另外，如果有某个线程需要I/O操作，或因缺页中断而被阻塞，所有的用户态线程都将一同被阻塞。所以，通常的语言级虚拟机都对此情况进行补救措施，例如使用专门的线程进行I/O操作，以及使用mmap等系统调用避免意外的缺页中断。

3. N:M，即混合线程：N个不同的用户态线程对应到M个内核线程上。这种模型是介于上述两种模型之间，看似可以兼顾两者的优点，实际上却产生了更多的问题。首先是模型变得复杂，不仅要考虑单个内核线程上的用户态线程的执行同步情况，而且还要考虑用户态线程可能在多个内核线程上的调度和同步，并且实际上并没有消除用户态线程的阻塞问题。所以在现实中使用混合模型的系统不是很多，比较典型的有golang和[Haskell][haskell-lwt]。

另外，一个比较容易想到的消除I/O同步阻塞的解决方案是使用异步IO，即线程不等待I/O处理子程序的完成便返回，事后再通过其他方式进行确认。不过这么好的方法怎么不去使用呢？Daniel Micay在[帖子][rust-thread]里提到，其原因有两点：

1. 历史原因，大多数的依赖库都是采用同步阻塞I/O，并利用原生内核线程进行并发的方式，在它们的基础上还无法简单地进行异步的改造；
2. 在操作系统发展的过程中，CPU的性能也在不断的改进，其中就包括上下文切换的性能，在该帖子中提到的他作的一个对比实验的结果表明，Rust的协程（我们知道，后来Rust把协程移除了标准库）和OS Thread在创建的开销上其实性能差别不大。

那么两种在上下文切换时开销差不都，但为什么实际系统中内核态线程在高并发上的性能又比协程差很多？这是因为**大量的开销实际消耗在了位于内核态的线程调度上**。通用操作系统内核为了支持多种不同计算场景（不只是高并发，还有实时计算场景等）下的综合性能，所以也需要较长的时间来调度（考虑是否要实时抢断，是否公平调度等）。但实际上，在云计算中，服务响应模型是比较简单的，通常简单轮询的调度都可以达到目的。


基于这样的事实，这就导致了Windows操作系统中UMS的产生。UMS中的线程依然是原生线程，但是在切换时，内核无需进入调度流程，直接将CPU控制权交给用户态我们自定义的调度器上。调度器可以根据应用的特点和需求做出更适合且高效的调度策略，选择一个线程执行，并将CPU的执行权交给它。在本文中，我们主要分析了一个基于[pervognsen的代码片段][ums-example]的UMS轻量级线程调度的简单实现，并和基于系统调度的普通原生线程，以及Windows的Fiber库实现的轻量级线程，三者进行性能对比测试，从中了解UMS的一些基础性能情况。具体的实现请见[Github仓库][github]。


## UMS概览


### 相关数据结构


1. **UMS工作线程(Worker thread)**：执行具体计算任务的线程，它们和普通的原生线程几乎具有相同的行为方式，并且进行系统调用，I/O或异常处理等不会阻塞其他线程。
2. **UMS调度器线程(Scheduler thread)**：UMS调度器线程本质上也是一个普通的线程，它负责对其他工作线程进行调度，执行调度策略，但它的执行时机还是需要由Windows来确定。
3. **线程上下文(Context)**：UMS线程上下文表示工作线程的状态，用于标识UMS函数调用中的工作线程。它通过调用`CreateUmsThreadContext`进行创建的。
4. **完成列表(Completion List)**：完成列表接收已在内核中完成执行并准备在用户模式下运行的UMS工作线程。只有Windows才能将工作线程排队到完成列表中。新的UMS工作线程自动排队到创建线程时指定的完成列表，以前阻塞的工作线程在不再被阻止时也会排队到完成列表。调度器线程可以查询完成列表，从而知道哪些线程已经处于就绪状态，然后再将这些线程加入自己私有的就绪队列中。
<!-- % 每个UMS调度器线程与单个完成列表相关联。但是，相同的完成列表可以与任意数量的UMS调度程序线程相关联，并且调度程序线程可以从具有指针的任何完成列表中检索UMS上下文。每个完成列表都有一个关联事件，当系统将一个或多个工作线程排入空列表时，系统会通过该事件发出信号。 `GetUmsCompletionListEvent`函数检索指定完成列表的事件句柄。应用程序可以等待多个完成列表事件以及对应用程序有意义的其他事件。
EnterUmsSchedulingMode的调用者指定完成列表和UmsSchedulerProc入口点函数以与UMS调度程序线程关联。完成将调用线程转换为UMS后，系统将调用指定的入口点函数。调度程序入口点函数负责确定指定线程的适当下一个操作。 -->




### UMS相关的API

* [`EnterUmsSchedulingMode`][EnterUmsSchedulingMode]：将调用线程转换为UMS的调度器线程。
* [`CreateUmsThreadContext`][CreateUmsThreadContext]：创建UMS工作线程的上下文。
* [`CreateUmsCompletionList`][CreateUmsCompletionList]：创建UMS完成列表。
* [`GetUmsCompletionListEvent`][GetUmsCompletionListEvent]：检索与指定的UMS完成列表关联的事件的句柄。
* [`UmsThreadYield`][UmsThreadYield]：在工作线程中调用，放弃CPU控制权，并触发CPU进入UMS调度器线程。
* [`ExecuteUmsThread`][ExecuteUmsThread]：运行指定的UMS工作线程。
* [`DequeueUmsCompletionListItems`][DequeueUmsCompletionListItems]：从UMS完成列表中将一个事件移出队列。
* [`QueryUmsThreadInformation`][QueryUmsThreadInformation]：检索有关指定的UMS工作线程的信息。
* [`SetUmsThreadInformation`][SetUmsThreadInformation]：为指定的UMS工作线程设置特定于应用程序的上下文信息。


## 核心流程的实现

## UMS工作线程和调度器线程

UMS工作线程的创建需要通过`CreateRemoteThreadEx`函数，这个跟普通线程没什么区别。不过在创建的`attribute`参数中需要设置`PROC_THREAD_ATTRIBUTE_UMS_THREAD`属性，并将通过`CreateUmsCompletionList`创建的完成列表，传递给`UMS_CREATE_THREAD_ATTRIBUTES`类型的参数。例如：

```cpp

    PPROC_THREAD_ATTRIBUTE_LIST attribute_list = 
        (PPROC_THREAD_ATTRIBUTE_LIST) HeapAlloc(GetProcessHeap(), 
                                                0, 
                                                attribute_list_size);
    InitializeProcThreadAttributeList(attribute_list, 1, 0, &attribute_list_size);

    UMS_CREATE_THREAD_ATTRIBUTES ums_thread_attributes;
    ums_thread_attributes.UmsVersion = UMS_VERSION;
    ums_thread_attributes.UmsContext = ums_context;
    ums_thread_attributes.UmsCompletionList = scheduler_completion_list;
    UpdateProcThreadAttribute(attribute_list, 
                              0, 
                              PROC_THREAD_ATTRIBUTE_UMS_THREAD, 
                              &ums_thread_attributes, 
                              sizeof(ums_thread_attributes), 
                              NULL, 
                              NULL);

    HANDLE thread = CreateRemoteThreadEx(GetCurrentProcess(), 
                                         NULL, 
                                         stack_size, 
                                         function, 
                                         parameter, 
                                         STACK_SIZE_PARAM_IS_A_RESERVATION, 
                                         attribute_list, 
                                         NULL);

```

应用的UMS调度器线程负责创建，管理和删除UMS工作线程并调度运行的UMS线程。它的创建过程是：通过`CreateThread`启动普通的线程，然后调用`EnterUmsSchedulingMode`函数将自身转换为UMS调度器线程类型：

```cpp
DWORD WINAPI SchedulerThreadFunction(void *parameter) {
    UMS_SCHEDULER_STARTUP_INFO scheduler_info;
    scheduler_info.UmsVersion = UMS_VERSION;
    scheduler_info.CompletionList = scheduler_completion_list;
    scheduler_info.SchedulerProc = SchedulerCallback;
    scheduler_info.SchedulerParam = NULL;
    BOOL result = EnterUmsSchedulingMode(&scheduler_info);
    return 0;
}
```

我们都知道，普通的原生线程在通过`CreateThread`创建后默认会直接参与调度并执行，而在UMS模式下，新创建的工作线程默认时不会马上运行，需要等到调度器线程选择它，并通过`ExecuteUmsThread`函数运行，例如：

```cpp
while (ready_queue.size() > 0) {
    PUMS_CONTEXT runnable_thread = ready_queue.front();
    ready_queue.pop_front();

    BOOLEAN terminated = FALSE;
    ExecuteUmsThread(runnable_thread);
}
```

### 调度子程序入口

刚才我们的调度器线程函数中，设定了调度回调函数，`SchedulerCallback`，该函数是`UmsSchedulerProc`类型，具有如下的原型。
```
void WINAPI UmsSchedulerProc(
    UMS_SCHEDULER_REASON reason, 
    ULONG_PTR payload, 
    void *parameter) {
```
该函数在如下三个时刻由系统自动的触发执行：

1. 通过调用`EnterUmsSchedulingMode`将非UMS线程转换为UMS调度线程时：

    {% asset_img creation.svg  转换成调度线程时 %}

2. 当UMS工作线程调用`UmsThreadYield`，主动放弃CPU的执行权时：
   
    {% asset_img yield.svg 线程调用UmsThreadYield时 %}

3. 当UMS工作线程调用阻塞的系统服务（如系统调用或页面错误）时：

    {% asset_img syscall.svg 线程调用阻塞的系统服务 %}

`UmsSchedulerProc`函数的`Reason`参数指定调用入口点函数的上述三种不同的原因之一，以便于调度子程序能够根据不同的原因，进行不同的后续调度策略，例如：
```cpp
switch (reason) {
    case UmsSchedulerStartup:
        SetEvent(scheduler_initialized_event);
        break;
    case UmsSchedulerThreadBlocked: {
        break;
    }
    case UmsSchedulerThreadYield: {
        PUMS_CONTEXT yielded_thread = (PUMS_CONTEXT) payload;
        void *yielded_parameter = parameter;
        ready_queue.push_back(yielded_thread);
        break;
    }
}

```

### UMS最佳实践


在实现UMS的应用程序时应遵循以下最佳实践：

1. UMS线程上下文的基础结构需由系统进行管理，不应直接修改，而是使用`QueryUmsThreadInformation`和`SetUmsThreadInformation`来检索和设置有关UMS工作线程的信息。
2. 为了防止死锁，UMS调度器线程不应与UMS工作线程共享锁，这包括应用程序创建的锁和通过诸如从堆分配或加载DLL等操作间接获取的系统锁。
3. 当大多数处理和计算在用户模式下完成时，UMS是最高效的，因为它尽可能避免在UMS工作线程中进行系统调用。
4. UMS工作线程不应假设正在使用系统调度程序，而应该考虑是被UMS调度器线程所调度。因此，不应使用系统API设置线程的优先级或亲和性。
5. 系统可能需要锁定UMS工作线程的线程上下文。如果调度器线程在工作线程被锁定时尝试执行该线程，则调用将失败。所以调度器线程设计为，重试对该工作线程上下文的访问。


## 性能测试

按照仓库中的[文档](https://github.com/zhangpf/cloud-demos/blob/master/windows-ums/README.md)进行编译并运行测试程序。在我的笔记本（Lenovo Thinkpad X270，Intel i5-6200U的4核处理器和8G主存）上:

1. **10**个线程并发：

|   yield数量   | 100   | 1000 | 10000 | 100000  |
| :----------------: | :---: | :---: | :----: | :---: |
| Native thread | 1201ns | 633ns  | 640ns | 632ns | 
| **UMS**    | 2752ns | 400ns | 148ns  | 118ns |
| Fiber  | 96ns | 105ns | 101ns  | 88ns |

2. **100**个线程并发：

|   yield数量   | 100   | 1000 | 10000 | 100000  |
| :----------------: | :---: | :---: | :----: | :---: |
| Native thread | 769ns | 610ns  | 601ns | 591ns | 
| **UMS**    | 1428ns | 245ns | 152ns  | 128ns |
| Fiber  | 130ns | 105ns | 102ns  | 102ns |

3. **1000**个线程并发：

|   yield数量   | 100   | 1000 | 10000 | 100000  |
| :----------------: | :---: | :---: | :----: | :---: |
| Native thread | 941ns | 790ns  | 793ns | 785ns | 
| **UMS**    | 1400ns | 276ns | 146ns  | 127ns |
| Fiber  | 175ns | 167ns | 177ns  | 180ns |


在少量线程（10或100）的情况下，Fiber要比UMS性能好一些，不过在1000个线程的情况下UMS的实现比Fiber有一定的提升。不过两者比原生的线程（Native thread）相比，还是有很大的提高。另外要值得说的是，从资源管理器里看，UMS似乎是只能在单核上并发，无法像原生线程那样直接利用多核，如果将原生线程那样也


## 总结

通过一个简单的性能对比，我们可以看到UMS在提升并发性能上比原生线程的调度要高出不少。但是，我们还是需要看到，UMS还是由一些方面的不足：

1. 自定义的线程调度使编码变得复杂，相对于原生线程和Fiber的实现，UMS的代码量大大增加了。所以改进方式是把相关的系统调用函数封装成易于调用的库，对上层提供透明的编程模块。
2. 性能对比里已经提到，UMS还是像Fiber那样只能利用单核，多核的扩展还是需要更多的支持。


从Win7开始，Windows提供UMS相关的功能已经有10年的时间，不过尚未看到该技术有大规模使用的案例，这也是其比较遗憾的一方面。不过这种通过自定义调度器的解决方法是值得借鉴的，因为它为利用原生线程提供大规模并发访问找到了一条可行的方式，并且给我们提供更多的思路来实现轻量级线程。

[thestinger]: https://github.com/thestinger
[ums-example]: https://gist.github.com/pervognsen/8cbde6ea71da8256865e05bf4fcdfa7d
[github]: https://github.com/zhangpf/cloud-demos/tree/master/windows-ums
[linux-attempt]: https://blog.linuxplumbersconf.org/2013/ocw/system/presentations/1653/original/LPC%20-%20User%20Threading.pdf
[haskell-lwt]: https://ghc.haskell.org/trac/ghc/wiki/LightweightConcurrency
[rust-threading]: http://thread.gmane.org/gmane.comp.lang.rust.devel/6479
[EnterUmsSchedulingMode]: https://docs.microsoft.com/en-us/windows/desktop/api/WinBase/nf-winbase-enterumsschedulingmode
[CreateUmsCompletionList]: https://docs.microsoft.com/en-us/windows/desktop/api/WinBase/nf-winbase-createumscompletionlist
[CreateUmsThreadContext]: https://docs.microsoft.com/en-us/windows/desktop/api/WinBase/nf-winbase-createumsthreadcontext
[UmsThreadYield]: https://docs.microsoft.com/en-us/windows/desktop/api/WinBase/nf-winbase-umsthreadyield
[GetUmsCompletionListEvent]: https://docs.microsoft.com/en-us/windows/desktop/api/WinBase/nf-winbase-getumscompletionlistevent
[DequeueUmsCompletionListItems]: https://docs.microsoft.com/en-us/windows/desktop/api/WinBase/nf-winbase-dequeueumscompletionlistitems
[ExecuteUmsThread]: https://docs.microsoft.com/en-us/windows/desktop/api/WinBase/nf-winbase-executeumsthread
[QueryUmsThreadInformation]: https://docs.microsoft.com/en-us/windows/desktop/api/WinBase/nf-winbase-queryumsthreadinformation
[SetUmsThreadInformation]: https://docs.microsoft.com/en-us/windows/desktop/api/WinBase/nf-winbase-setumsthreadinformation
[UMS]: https://docs.microsoft.com/en-us/windows/desktop/procthread/user-mode-scheduling