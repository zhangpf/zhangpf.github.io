---
title: 【译文】将Restartable Sequcences (rseq)引入Linux的五年之旅
date: 2020-01-23 09:34:01
tags: [Linux, Restartable Sequcences, Concurrency, 并发]
categories: 中文
---


<!-- 
Concurrency control algorithms, paired with per-CPU data, are integral to ensuring low-level libraries and high-performance applications scale properly on today's hardware. These algorithms guarantee that user-space data structures are kept consistent in the face of simultaneous accesses, and that modifications are done wholly so that threads see either the before or after state, but not in between. 
-->

并发控制算法与per-CPU数据成对出现，是确保底层库和高性能应用程序在当今硬件上正确扩展不可或缺的一部分。这些算法保证在并发访问时，用户空间的数据结构始终保持一致，并且用户数据的修改是执行完全的，使得线程观察到的是之前或之后的状态，而非中间状态。

<!-- 
There are a number of ways to design these algorithms. The most common, though least scalable, is with mutual exclusion which works by allowing only one thread to modify the data structure at any one time — and that's the thread holding the mutex. 
-->

设计这些算法的方法有很多种，最常见的也是扩展性最差的一种是mutex。
它的工作原理是，在任何时间，只允许一个线程持有mutex并修改共享数据结构。


<!-- 
But mutual exclusion doesn't scale well, particularly with per-CPU data. Since only one thread can be within the critical section bookended by the mutex lock and unlock sequence, it's possible to have many threads waiting to acquire the lock. And time waiting for locks is time not spent doing useful work. 
-->

但是，mutex并不能很好地扩展，尤其是对于per-CPU数据而言。
由于在mutex加锁和解锁的临界区内只能有一个线程可访问，因此可能存在大量线程在等待锁，而等待的时间内线程没有做任何有用的事。


<!--
The next step up on the list of scalable algorithms is atomic compare and swap. In this model, a single instruction is used such as cmpxchg or the lock prefix in the case of x86.
-->
接下来的可扩展并发控制算法是，原子比较和交换。在这个模型中，通常使用单个指令进行同步控制，例如`cmpxchg`指令或x86体系结构的指令lock前缀。

<!--
The problem here though is that atomic instructions are relatively expensive on modern processors. The x86 lock prefix can easily add many cycles to the cost of the same instruction without the prefix. To make matters worse, regardless of whether there's only one thread executing the instruction or not the lock prefix will be executed.
-->
但这里的问题是，在现代处理器上原子指令代价很高，相比于没有前缀的相同指令，x86的lock前缀很容易在执行成本上增加多个指令周期。
更糟糕的是，无论是否只有一个线程在竞争，lock前缀都会无条件执行。

<!--
And not all architectures provide a single instruction for atomically updating data. For instance, ARM uses link-load/store-conditional instructions to read the old data, modify it, and write the new data. If two threads try to write the same data simultaneously only one will succeed and the other will fail and restart the read-modify-write sequence.
-->
并且，并不是所有体系结构都为原子数据更新提供单独的指令。例如，ARM使用link-load/store-conditional（简称LL/SC）组合指令来读取原始数据、修改原始数据并写入新数据，
如果两个线程同时尝试写入，只有一个线程将会成功，另一个线程失败并重启LL/SC指令序列。

<!--
The Linux kernel uses other methods of protecting per-CPU data, such as disabling preemption or interrupts, or using “percpu” local atomic operations. Unfortunately, these mechanisms are either not readily available to user-space, or they're comparatively slow (as is the case with the atomic instructions). Instead, what's needed is a lightweight mechanism for user-space to protect per-CPU data. This is the motivation for restartable sequences.
-->
Linux内核使用其他方法来保护per-CPU数据，例如禁用抢占或中断，或使用per-CPU本地的原子操作。遗憾的是，这些方法要么不易被用户空间使用，要么相对较慢（例如原子指令）。
所以，我们需要一种轻量型的机制，用于在用户空间内保护per-CPU数据，这就是restartable sequences方法（rseq）的产生的动机。


<!-- ## How Restartable Sequences Work -->
## rseq是如何工作的

<!-- Restartable sequences are built with a new system call, rseq(2), that tells the kernel where the restartable sequence's thread-local storage ABI (a struct rseq object) is located for the current thread. This object contains a rseq_cs field which is a pointer to the currently active restartable sequence critical section descriptor (a struct rseq_cs object). Only one critical section can be active at any time. This ABI has two purposes: user-space restartable sequences and a way to quickly read the current CPU number. -->

rseq由新的系统调用`rseq(2)`所组成，该调用告诉内核当前线程rseq相关的thread-local ABI（`sturct rseq`对象）在内存中的位置。`sturct rseq`对象包含一个`rseq_cs`类型字段，该字段是指向当前被激活的rseq临界区的描述符（`sturct rseq_cs`对象）的指针，而在任何时候，只能有一个临界区被激活。
此ABI有两个用途：用户空间的rseq和快速读取当前CPU编号。


<!--
The critical section is subdivided into preparatory and commit stages, where the commit step is a single CPU instruction. The critical section is said to have been interrupted if any of the following occur before the commit step:

The thread is migrated to another CPU
A signal is delivered to the thread
The thread is preempted
-->
临界区可细分为准备阶段（preparatory stage）和提交阶段（commit stages），其中提交阶段是仅是单条CPU指令。
如果在提交阶段之前发生以下任何情况之一，则认为当前临界区被中断：

1. 线程已迁移到另一个CPU上
2. 信号（signal）被传递到该线程
3. 线程被抢占

<!--
Additionally, because a fallback mechanism is required when the thread is interrupted, the kernel sets the instruction pointer to the start of an abort handler which can take some corrective action, for example retrying the preparatory step.
-->

<!-- 
With this design, the optimistic case (where the thread isn't interrupted) is extremely fast because expensive locks and atomic instructions can be entirely avoided. -->

<!-- Getting down into the details, the current restartable sequence critical section is described by a struct rseq_cs object which is referenced by a struct rseq object. Here's a diagram to illustrate the relationship and the structure members. -->


此外，由于线程被中断时需要回退机制，内核将程序寄存器（instruction pointer）指向中断处理程序的首地址，该处理程序需要执行一些纠正性的措施，例如重新发起准备阶段。
在这样的设计下，乐观情况下（线程未被中断）执行速度非常快，因为开销较高的`struct rseq_cs`的上锁和原子指令可完全避免。

更详细地说，当前rseq临界区是由`struct rseq_cs`对象所描述，该对象被`struct rseq`对象所引用。下面用如下的图来说明它们的关系和结构体的字段。

{% asset_img restartable-sequences-diagram.png rseq_cs结构体和字段描述(来自于 www.efficios.com) %} 

<!-- The start and end of the restartable sequence are denoted by the start_ip and post_commit_ip (which points to the instruction after the commit instruction), and the abort_ip points to the first instruction of the abort handler. -->

rseq的开始和结束由`start_ip`和`post_commit_ip`（指向提交阶段后的首地址指令）所表示，而`abort_ip`指向中断处理程序的首地址指令。

<!-- 
There are restrictions on the implementation of both the critical section and the abort handler. For one, the abort handler must be outside the critical section. Secondly, system calls are not permitted within a critical section, and attempting to execute a system call will cause the process to be terminated via a segmentation fault. 
-->

值得注意的是，临界区和中断处理程序的实现都有所限制。例如，中止处理程序必须处于临界区以外，以及在临界区内不允许有系统调用，尝试执行系统调用将导致进程发生segmentation fault而终止。

<!-- The cpu_id field is updated by the kernel whenever a thread migrates to a new CPU and user-space programs are expected to read cpu_id_start at the beginning of the critical section and compare the two values. If they differ then the running thread was interrupted and the restartable sequence needs to be retried. -->
每当线程迁移到其他CPU上执行，且在用户空间程序临界区的开始处读取`cpu_id_start`并比较这两个值时，内核就会更新`cpu_id`字段。
如果它们的值不同，则正在运行的线程将被中断，且需要重新尝试rseq序列。

<!-- 
The rseq_cs field is modified by both the kernel and user-space. When beginning a restartable sequence, user-space code needs to set the pointer to the current critical section descriptor. The kernel sets this pointer to NULL whenever it preempts or delivers a signal while executing a region of code that lays outside of the critical section range described by the current rseq_cs descriptor. 
-->
内核和用户空间均可修改`rseq_cs`字段。当启动rseq时，用户空间代码需要将指针设置为当前临界区的描述符。
每当在执行当前`rseq_cs`描述符所描述的临界区范围之外的代码时，或发生抢断或传递信号时，就会将该指针设置为`NULL`。


## rseq的简史

<!-- 
Support for restartable sequences was merged in Linux 4.18. The concept of restartable sequences, or rseq, was originally proposed by Paul Turner and Andrew Hunter in 2013 as a way to safely access per-CPU data from user-space data without locks or expensive atomic instructions. But at the time no patches were available. 
-->

Linux在4.18内核版本中合并了对rseq的支持。作为一种无需锁或开销较高的原子指令，即可从用户空间数据中安全访问per-CPU数据的方法，restartable sequences的概念最初是由[Paul Turner和Andrew Hunter在2013年所提出](https://blog.linuxplumbersconf.org/2013/ocw/system/presentations/1695/original/LPC%20-%20PerCpu%20Atomics.pdf)，但在当时还没有可用的patch。

<!-- After two years — and in an effort to cajole them into posting their patches to the Linux kernel mailing list — Mathieu Desnoyers submitted his own patches for per-CPU critical sections in May 2015. A month later, the very first patch series for restartable sequences was posted by Paul. After momentum died down on Paul's version, Mathieu picked it up in 2016 and submitted a new series and covered them in a talk at Linux Plumbers Conference 2016. He had hoped to get the patches merged for version 4.15 of the Linux kernel but there was a snag… -->


两年后，为了促使他们将其补丁发布到Linux kernel的mailing list中，Mathieu Desnoyers于2015年5月提交了针对[per-CPU临界区](https://lwn.net/Articles/645717/)的patch。
一个月后，Paul发布了[rseq的第一个patch集合](https://lwn.net/Articles/649288/)。
虽然Paul在发布该版本之后便停了下来，Mathieu于2016年又重新接手，提交了新的[patch集合](https://lwn.net/Articles/697756/)，并在[LPC 2016](https://blog.linuxplumbersconf.org/2016/ocw/system/presentations/3873/original/presentation-rseq-lpc2016.pdf)上介绍了这一工作。
他原本希望将patch合并到Linux内核的4.15版本中，但发现存在如下的障碍：

<!-- 
While benchmark data was available with pretty much every version of the patch series, Linus made it clear that hypothetical use cases were not reason enough to merge the restartable sequences feature, and that concrete performance numbers were necessary. 
-->

虽然几乎每个版本的patch集都有benchmark数据，但Linus明确表示，这种假设的用例[不足以](https://lwn.net/Articles/697991/)合并rseq的相关功能，并需要具体的[性能数据](https://www.mail-archive.com/linux-kernel@vger.kernel.org/msg1213874.html)作为支撑。


<!-- Facebook had already provided results for using the patches with the jemalloc memory allocator. So, Mathieu set about collecting more benchmark results and getting rseq support ready for other projects such as LTTng-UST, Userspace RCU, and glibc. 
-->

<!-- Finally, after five years the series was merged into the Linux kernel, and Mathieu gave a talk at the Open Source Summit Europe 2018 entitled Improve Linux User-Space Core Libraries with Restartable Sequences which covered the multi-year effort of bringing restartable sequences to Linux. 
-->


后来，Facebook提供了在jemalloc内存分配器上使用patch的[数据结果](https://lwn.net/Articles/661839/)。
因此，Mathieu收集了更多类似的benchmark结果，并在其他项目（如[LTTng-UST](https://github.com/lttng/lttng-ust)、[Userspace RCU](https://liburcu.org/)和[glibc](https://www.gnu.org/s/libc/)）上提供了rseq的支持。

最终，在最初开始的五年之后，该patch集终于被合并到Linux内核中，Mathieu在Open Source Summit Europe 2018上作了名为[Improve Linux User-Space Core Libraries with Restartable Sequences](https://events.linuxfoundation.org/wp-content/uploads/2017/12/Improve-Linux-User-Space-Core-Libraries-with-Restartable-Sequences-Mathieu-Desnoyers-EfficiOS.pdf)的演讲，其中介绍了将rseq带入Linux的多年努力。

<!-- ## How to Use rseq in your Library or Application -->
## 如何在库和程序中使用rseq

<!-- The preferred approach to using restartable sequences is to use the librseq library which provides all the per-CPU operations you're likely to need such as making rseq(2) available to the current thread (rseq_register_current_thread()), looking up the CPU number of the current thread (rseq_current_cpu()), and updating per-CPU data (rseq_cmpeqv_storev()). -->

使用rseq的首选方法是使用[librseq](https://github.com/compudj/librseq)，该库提供了可能会用到的所有per-CPU操作，例如使`rseq(2)`调用对当前线程可用（`rseq_register_current_thread()`），查询当前线程的CPU编号（`rseq_current_cpu()`），以及更新per-CPU数据（`rseq_cmpeqv_storev()`）。


<!-- But if you want to roll your own operations, read on for a more detailed explanation. -->
但如果要实现自己需要的特定操作，请继续阅读以获得更详细的说明。

<!-- Using rseq(2) requires two steps. First, you need to enable the functionality for the current thread with the rseq(2) system call. The system call has the following prototype: -->

使用`rseq(2)`需要以下两步。首先，使用`rseq(2)`为当前线程启用该功能，
该系统调用具有以下的函数原型：

```c
sys_rseq(struct rseq *rseq, uint32_t rseq_len, int flags, uint32_t sig)
```
<!-- 
The purpose of the system call is to register a struct rseq object with the kernel. The flags argument is 0 for registration and rseq_FLAG_UNREGISTER for unregistration. The sig argument is a signature that can be used to validate the rseq context, in other words the signature used for registration must be the same one used for unregistration. 
-->

该系统调用的目的是向内核注册`struct rseq`对象，其中`flags`参数为0表示注册，`rseq_FLAG_UNREGISTER`表示注销。
`sig`参数是可用于验证rseq上下文的签名，也就是说，用于注册的签名必须与用于注销的签名相同。

<!--
Let's assume you want to increment a per-CPU counter using rseq(2). To do that, you need to get the CPU number of the current thread (stored in the cpu_id_start field of struct rseq) and modify the per-CPU counter using a restartable sequence. This is done with a mixture of C and assembly. Here's the code to do that.
-->
比如说，你想使用`rseq(2)`来增加per-CPU计数器的值，为此，需要获取当前线程的CPU编号（存储在`struct rseq`的`cpu_id_start`字段中），并使用rseq修改per-CPU计数器的值。
因此，需要通过C和汇编混写的代码实现，下面是完成该操作的代码。

```c
#define _GNU_SOURCE
#include <linux/rseq.h>
#include <stdio.h>
#include <stdlib.h>
#include <syscall.h>
#include <stdint.h>
#include <unistd.h>
#include <sys/syscall.h>

static __thread volatile struct rseq __rseq_abi;

#define rseq_SIG	0x53053053

static int sys_rseq(volatile struct rseq *rseq_abi, uint32_t rseq_len,
			int flags, uint32_t sig)
{
	return syscall(__NR_rseq, rseq_abi, rseq_len, flags, sig);
}


static void register_thread(void)
{
	int rc;
	rc = sys_rseq(&__rseq_abi, sizeof(struct rseq), 0, rseq_SIG);
	if (rc) {
		fprintf(stderr, "Failed to register rseq\n");
		exit(1);
	}
}

#define rseq_ACCESS_ONCE(x)     (*(__volatile__  __typeof__(x) *)&(x))

static int rseq_addv(intptr_t *v, intptr_t count, int cpu)
{
	__asm__ __volatile__ goto(
		".pushsection __rseq_table, \"aw\"\n\t"
		".balign 32\n\t"
		"cs_obj:\n\t"
		".long 0, 0\n\t"
		/* start_ip, post_commit_ip, abort_ip */
		".quad 1f, 2f, 4f\n\t"
		".popsection\n\t"
		"1:\n\t"
		"leaq cs_obj(%%rip), %%rax\n\t"
		"movq %%rax, %[rseq_cs]\n\t"
		"cmpl %[cpu_id], %[current_cpu_id]\n\t"
		"jnz 4f\n\t"
		"addq %[count], %[v]\n\t"	/* final store */
		"2:\n\t"
		".pushsection __rseq_failure, \"ax\"\n\t"
		/* Disassembler-friendly signature: nopl <sig>(%rip). */
		".byte 0x0f, 0x1f, 0x05\n\t"
		".long 0x53053053\n\t"	/* rseq_FLAGS */
		"4:\n\t"
		"jmp abort\n\t"
		".popsection\n\t"
		: /* gcc asm goto does not allow outputs */
	       	: [cpu_id]              "r" (cpu),
		[current_cpu_id]      "m" (__rseq_abi.cpu_id),
		[rseq_cs]             "m" (__rseq_abi.rseq_cs),
		/* final store input */
		[v]                   "m" (*v),
		[count]               "er" (count)
		: "memory", "cc", "rax"
		: abort
	);

	return 0;
abort:
	return -1;
}

int main(int argc, char **argv)
{
	int cpu, ret;
	intptr_t *cpu_data;
	long nr_cpus = sysconf(_SC_NPROCESSORS_ONLN);
	
	cpu_data = calloc(nr_cpus, sizeof(*cpu_data));
	if (!cpu_data) {
		perror("calloc");
		exit(EXIT_FAILURE);
	}

	register_thread();
	cpu = rseq_ACCESS_ONCE(__rseq_abi.cpu_id_start);
	ret = rseq_addv(&cpu_data[cpu], 1, cpu);
	if (ret)
		fprintf(stderr, "Failed to increment per-cpu counter\n");
	else
		printf("cpu_data[%d] == %ld\n", cpu, cpu_data[cpu]);

	return 0;
}
```

<!-- 
The code in rseq_addv() begins by filling out a struct rseq_cs object that describes the segment of the restartable sequence denoted by the start symbol 1, the post-commit address 2, and the abort handler 4. If the thread does not complete the sequence between labels 1 and 2 control jumps to the 4 label and then to the abort label in C. 
-->
`rseq_addv()`中的代码以`struct rseq_cs`对象填充作为开始，该对象描述了rseq中的字段，其中start的label为`1`，post-commit为`2`，中断处理程序为`4`。
如果线程未完成`1`和`2`之间的序列，那么将直接控制跳转到标签`4`，然后跳转到C中的`abort`位置处。

<!-- 
A word of caution: you must ensure that the CPU number is only read once. Compilers need to be coerced into guaranteeing that with the volatile keyword. The rseq_ACCESS_ONCE() macro above guarantees this. 
-->

注意：必须确保CPU编号只读取一次，在编译器层面需要强制使用`volatile`关键字来保证这一点，而在上面的例子中，`rseq_ACCESS_ONCE()`宏对此提供了保证。

<!-- ## Exactly How Much Faster is rseq? -->
## rseq到底有多快?

<!-- 
One of the main use cases for restartable sequence is getting the CPU number that the current thread is executing on — usually to then be used as an index into a per-CPU data structure. The existing method of using sched_getcpu() to discover the CPU number requires a system call on ARM and invokes the VDSO on x86. But rseq(2) allows you to read a cached CPU number value in the struct rseq object shared between kernel and user-space. 
-->

rseq的主要使用场景之一是获取执行当前线程的CPU编号，通常也就是指向per-CPU数据结构的索引值。当前使用`sched_getcpu()`来获取CPU编号的方法，在ARM上需进行系统调用，在 x86上需调用VDSO，而`rseq(2)`则允许程序直接读取内核和用户空间之间共享的`struct rseq`对象中缓存的CPU编号值。

<!-- 
The rseq approach results in a 20x speedup on x86 and 35x speedup on ARM. 
-->

在该场景下，rseq在X86平台可获得20倍加速，而在ARM平台上则是35倍加速。

<!-- 
Here's a graph demonstrating the relative speed improvements of the alternative methods of getting the CPU number for the current thread. In all the following graphs, smaller values are better and reflect a speed increase. 
-->

下图展示了获取执行当前线程的CPU编号的rseq方法的速度提升，值越小越好，其反映了速度的提升。

{% asset_img rseq-arm32-getcpu.png  %} |  {% asset_img rseq-x86-64-getcpu.png  %}
:-:|:-:
 在arm32上读取当前CPU编号benchmark(来自于 www.efficios.com) |  在x86_64上读取当前CPU编号benchmark(来自于 www.efficios.com)

<!-- 
As discussed above, there are a number of use-cases that rseq is suitable for. One of the most common uses of per-CPU data is for storing counters. The following graph shows the speed improvements when incrementing a per-CPU counter with rseq(2) versus using sched_getcpu() and atomic instructions. ARM shows an 11x speedup and x86 shows 7.7x. 
-->
如上所述，rseq也适用于其他多种使用per-CPU数据的场景，其中之一是存储计数器值。下图展示了使用`rseq(2)`增加per-CPU计数器时，相对于使用`sched_getcpu()`和原子指令的速度提升。在ARM平台上显示有11倍的提升，而在x86显示是7.7倍提升。

{% asset_img rseq-arm32-percpu-stats.png  %} |  {% asset_img rseq-x86-64-percpu-stats.png  %}	
:-:|:-:
 在arm32上统计增加计数器benchmark(来自于 www.efficios.com) | 在x86_64上统计增加计数器benchmark(来自于 www.efficios.com)
<!-- 
 {% asset_img rseq-arm32-percpu-stats.png 在arm32上统计计数器增加benchmark（来自 www.efficios.com） %}	 {% asset_img rseq-x86-64-percpu-stats.png 在x86_64上统计计数器增加benchmark（来自 www.efficios.com） %}	 -->

<!-- LTTng-UST uses per-CPU buffers to store events. The graph below shows the performance improvement when storing 32-bit header and 32-bit event payload into a per-CPU buffer using sched_getcpu() and atomic instructions or rseq. ARM received a 1.1x speedup and x86 saw a 1.2x improvement. -->
LTTng-UST使用per-CPU的buffer来存储event。下图展示了使用`rseq(2)`在per-CPU缓存中存储32位header和event时，相对于使用`sched_getcpu()`和原子指令的速度提升。在ARM平台上显示有1.1x的提升，而在x86显示是1.2x提升。

{% asset_img rseq-arm32-lttng-ust.png %} |  {% asset_img  rseq-x86-64-lttng-ust.png  %}
:-:|:-:
 在arm32的LTTng-UST上将event写入per-CPU缓存的benchmark(来自于 www.efficios.com) |   在x86_64的LTTng-UST上将event写入per-CPU缓存的benchmark(来自于 www.efficios.com)

<!-- And finally, using rseq in liburcu from the Userspace RCU project results in a 5.8x speedup on ARM and a 1.9x speedup on x86. -->

最后，在Userspace RCU项目中，在liburcu库中使用rseq后，在ARM有5.8倍加速，而在x86上有1.9倍加速。

{% asset_img rseq-arm32-liburcu.png %} |  {% asset_img  rseq-x86-64-liburcu.png  %}
:-:|:-:
 在arm32的liburcu的per-CPU上加/解锁，解引用读/比较的benchmark(来自 于www.efficios.com) |   在x86_64的liburcu的per-CPU上加/解锁，解引用读/比较的benchmark(来自于www.efficios.com)


<!-- ## What's Next? -->
## 下一步计划
<!-- 
While patches to use rseq(2) exist for LTTng, Userspace RCU, and glibc, however they're only at the proof of concept stage. The next phase is to get them merged into their respective projects. For glibc, that means patches to automatically register with rseq(2) at thread start time, unregister on thread exit, and at NPTL initialization for the main thread. -->

<!-- LTTng-UST is in a slightly different situation because of a shortcoming with the current design: it's not possible to move data between per-CPU data structures without also needing to change the thread's affinity mask. To solve this problem Mathieu has proposed a new cpu_opv system call that executes a vector of fixed operations (comparison, memcpy, and add) on a specific CPU, similar to the struct iovec concept with readv(2) and writev(2). Another issue with rseq(2) that is solved with cpu_opv is that if you single-step through a critical section the debugger will loop forever. The new cpu_opv system call will allow debuggers to work with existing applications even if libraries make use of rseq(2). -->

<!-- Mathieu had originally hoped to get the new cpu_opv system call merged in time for the Linux kernel 4.21 release, but Linus Torvalds has made it clear that he wants to see users of rseq(2) implemented first. Meaning those work in progress rseq(2) patches for glibc need to be merged. -->

虽然使用`rseq(2)`的patch适用于LTTng、Userspace RCU和glibc，但它们现在仅处于概念验证阶段。下一阶段的工作，则是将它们合并到各自项目的代码中。
对于glibc而言，这意味着patch在线程开始时自动通过`rseq(2)`注册，在线程退出，以及主线程的NPTL初始化时自动注销。

LTTng-UST的问题有点不同：不更改线程的affinity mask，就无法在per-CPU数据结构之间移动数据。为了解决这个问题，Mathieu提出了一个新的[`cpu_opv`系统调用](https://lore.kernel.org/lkml/20181101095844.24462-1-mathieu.desnoyers@efficios.com/T/#u)，类似`readv(2)`和`writev(2)`的`struct iovec`概念，该调用在特定CPU上执行固定向量操作（比较、memcpy 和add）。`cpu_opv`解决的`rseq(2)`的另一个问题是，如果单步执行到临界区，调试器将死循环。即使库使用了`rseq(2)`，新的`cpu_opv`系统调用也允许调试器与现有应用程序共存。

Mathieu最初希望能及时将新的`cpu_opv`系统调用合并到Linux内核的4.21版本，但Linus Torvalds已经表示，他希望看到[`rseq(2)`的使用者](https://lore.kernel.org/lkml/CAHk-=wjk-2c4XvWjdzc-bs9Hbgvy-p7ASSnKKphggr5qDoXRDQ@mail.gmail.com/T/#u)首先出现，这意味着glibc需要合并那些正在进行的`rseq(2)`的patch工作。

*(译者注：本文原地址为 https://www.efficios.com/blog/2019/02/08/linux-restartable-sequences/)*
