---
title: 【译文】在.NET上通过Wasmtime使用WebAssembly
date: 2020-01-18 16:06:49
tags: [WebAssembly, Rust, Wasmtime, .NET]
categories: 中文
---


<!-- Wasmtime, the WebAssembly runtime from the Bytecode Alliance, recently added an early preview of an API for .NET Core, Microsoft’s free, open-source, and cross-platform application runtime. This API enables developers to programmatically load and execute WebAssembly code directly from their .NET programs.

.NET Core is already a cross-platform runtime, so why should .NET developers pay any attention to WebAssembly?

There are several reasons to be excited about WebAssembly if you’re a .NET developer, such as sharing the same executable code across platforms, being able to securely isolate untrusted code, and having a seamless interop experience with the upcoming WebAssembly interface types proposal. -->

来自[字节码联盟（Bytecode Alliance）](https://bytecodealliance.org/articles/announcing-the-bytecode-alliance)的WebAssembly（以下简称wasm）运行时，[Wasmtime](https://github.com/bytecodealliance/wasmtime/)，
最近添加了针对免费，开源和跨平台的，微软应用程序运行时.NET Core的早期预览版本API。开发者可以在他们的.NET程序中使用该API直接编程加载和运行wasm代码。

.NET Core已经是跨平台的运行时，为什么.NET开发者还需关注于wasm上？

如果你是.NET开发者，那么这里有几个让你对wasm感到兴奋的地方，这包括在**所有平台上共用同一份可执行代码**，**能够安全地隔离不可信代码**，以及**通过未来的wasm接口类型提案（WebAssembly interface type proposal）来获得无缝的互操作体验**等。

<!-- # Share more code across platforms -->
### 在平台间共享更多的代码

<!-- .NET assemblies can already be built for cross-platform use, but using a native library (for example, a library written in C or Rust) can be difficult because it requires native interop and distributing a platform-specific build of the library for each supported platform.

However, if the native library were compiled to WebAssembly, the same WebAssembly module could be used across many different platforms and programming environments, including .NET; this would simplify the distribution of the library and the applications that depend on it. -->

.NET编译后代码已经可以跨平台使用，但使用本地库（例如，通过C或Rust写成的库）却依然困难，因为它需要本地的互操作，并且为每一个所支持的平台提供单独的平台相关的构建。

然而，如果C或者Rust库被编译成wasm模块，那么同一个模块可以被不同的平台和编程环境所使用，这其中也包括.NET环境。那么，这将大大简化库和使用这些库的应用的分发。

<!-- ## Securely isolate untrusted code -->
### 安全隔离不可信代码

<!-- The .NET Framework attempted to sandbox untrusted code with technologies such as Code Access Security and Application Domains, but ultimately these failed to properly isolate untrusted code. As a result, Microsoft deprecated their use for sandboxing and ultimately removed them from .NET Core.

Have you ever wanted to load untrusted plugins in your application but couldn’t figure out a way to prevent the plugin from invoking arbitrary system calls or from directly reading your process’ memory? You can do this with WebAssembly because it was designed for the web, an environment where untrusted code executes every time you visit a website.

A WebAssembly module can only call the external functions it explicitly imports from a host environment, and may only access a region of memory given to it by the host. We can leverage this design to sandbox code in a .NET program too! -->

.NET曾设计使用代码访问安全性（Code Access Security）和应用程序域（Application Domain）来沙箱化不可信代码，但最终这些技术都未能有效地对不可信代码进行隔离。结果微软最后放弃了沙箱化，并最终将这些技术从.NET Core中移除。

可是，你是否曾经在你的应用中加载不可信插件时，却找不到一种方法来防止插件进行任意系统调用或者直接读取进程的内存。现在，可以通过wasm来达到该目的，因为wasm最初是为Web环境所设计，Web环境是每当用户访问网站时，不可信代码都无时不刻在执行的环境。

<!-- ## Improved interoperability with interface types -->
### 通过接口类型改进互操作性
<!-- 
The WebAssembly interface types proposal introduces a way for WebAssembly to better integrate with programming languages by reducing the amount of glue code that is necessary to pass more complex types back and forth between the hosting application and a WebAssembly module.

When support for interface types is eventually implemented by the Wasmtime for .NET API, it will enable a seamless experience for exchanging complex types between WebAssembly and .NET. -->

wasm的接口类型提案引入了一种新方法，该方法可以减少在托管应用程序和wasm模块之间来回传递更复杂类型所需的粘合代码。新方法的目的是使得wasm可以更好地与编程语言所集成。

当Wasmtime最终为.NET的API实现对接口类型的支持后，它将为在wasm和.NET之间交换复杂类型提供无缝的体验。 

## 深入研究通过.NET使用wasm

<!-- In this article we’ll dive into using a Rust library compiled to WebAssembly from .NET with the Wasmtime for .NET API, so it will help to be a little familiar with the C# programming language to follow along.

The API described here is fairly low-level. That means that there is quite a bit of glue code required for conceptually simple operations, such as passing or receiving a string value.

In the future we’ll also provide a higher-level API based on WebAssembly interface types which will significantly reduce the code required for the same operations. Using that API will enable interacting with a WebAssembly module from .NET as easily as you would a .NET assembly.

Note also that the API is still under active development and will change in backwards-incompatible ways. We’re aiming to stabilize it as we stabilize Wasmtime itself.

If you’re reading this and you aren’t a .NET developer, that’s okay! Check out the Wasmtime Demos repository for corresponding implementations for Python, Node.js, and Rust too! -->

接下来，我们将深入研究如何使用针对.NET的Wasmtime API，在.NET中使用编译为wasm模块的Rust库，因此对C#编程语言稍微熟悉会有所帮助。

这里描述的API相当底层，它意味着，在概念上简单的操作（例如传递或接受字符串）需要大量的粘合代码。

将来，我们还将基于[wasm接口类型](https://hacks.mozilla.org/2019/08/webassembly-interface-types/)提供更高级别的API，这将大大减少相同操作所需的代码。
使用该API将使你可以像正常.NET程序一样轻松地在.NET中与wasm模块之间进行交互。

还请注意的是，该API仍在开发中，并且可能以向后不兼容的方式发生改变，因为我们的目标是保持Wasmtime本身的稳定性。

如果你不是.NET开发者，那也没问题，请查看[Wasmtime的demo代码库](https://github.com/bytecodealliance/wasmtime-demos)，以获取相应的Python，Node.js和Rust等版本的实现。


## 创建wasm模块


<!-- We’ll start by building a Rust library that can be used to render Markdown to HTML. However, instead of compiling the Rust library for your processor architecture, we’ll be compiling it to WebAssembly so we can use it from .NET.

You don’t need to be familiar with the Rust programming language to follow along, but it will help to have a Rust toolchain installed if you want to build the WebAssembly module. See the homepage for Rustup for an easy way to install a Rust toolchain.

Additionally, we’re going to use cargo-wasi, a command that bootstraps everything we need for Rust to target WebAssembly: -->

我们将从构建Rust库开始，该库可用于将[markdown](https://commonmark.org/)文档渲染为HTML。
前面已经提到，我们不会将Rust库编译为特定目标体系结构，而是将其编译为wasm格式，使得它们可以在.NET使用。

你并不需要对[Rust编程语言](https://www.rust-lang.org/)熟悉，但是如果是构建wasm模块，则安装相应的Rust工具链是有用的。
有关安装Rust工具链的简便方法，请参考[Rustup](https://rustup.rs/)主页。

此外，我们将使用[cargo-wasi](https://github.com/bytecodealliance/cargo-wasi)，该命令可创建将Rust编译wasm所需的基础代码和编译环境：

```bash
cargo install cargo-wasi
```

然后，克隆Wasmtime的demo代码库：

```bash
git clone https://github.com/bytecodealliance/wasmtime-demos.git
cd wasmtime-demos
```

<!-- 
This repository includes the markdown directory that contains a Rust library. The library wraps a well-known Rust crate that can render Markdown as HTML. (Note for .NET developers: a crate is like a NuGet package, in a way).

Let’s build the markdown WebAssembly module using cargo-wasi: -->

该代码库包括`markdown`文件目录和相应的Rust代码，其中Rust代码只是封装了另一个crate（`pulldown_cmark`），其功能是将markdown渲染为HTML格式
*（.NET开发者需要注意的是，在某种程度上，rust crate可以类比为NuGet包）*。

然后使用`cargo-wasi`构建`markdown`的wasm模块：

```bash
cd markdown
cargo wasi build --release
```

此时，`target/wasm32-wasi/release`目录中应有编译后的`markdown.wasm`文件。

如果你对实现的rust代码该兴趣，请参看`src/lib.rs`文件，它包含如下内容：

```rust
use pulldown_cmark::{html, Parser};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn render(input: &str) -> String {
    let parser = Parser::new(input);
    let mut html_output = String::new();
    html::push_html(&mut html_output, parser);
    return html_output;
}
```

该rust代码的功能是export函数`render`，该函数的功能是将markdown格式字符串作为输入，处理并返回渲染后HTML格式的字符串。这里[pulldown-cmark](https://github.com/raphlinus/pulldown-cmark)库提供了解析markdown并将其转换为HTML所需的所有代码。

让我们后退一步，简单地了解一下这里将要发生的事情。我们使用了一个Rust现有的crate，并用几行代码将其封装，其功能作为wasm函数进行了export，然后将其编译为可在.NET加载的wasm模块。这里我们不用再考虑该模块将在什么平台（体系结构）上运行，很酷啊兄弟，不是么？！

### 检视wasm模块内部

现在我们已经有了将要使用的wasm模块，那么host需要为它需提供怎样的功能，它又为host提供了怎样的功能？

为了弄清楚这一点，让我们使用[WebAssembly Binary Toolkit](https://github.com/WebAssembly/wabt)里的`wasm2wat`工具，将模块反汇编成可读文本表示的形式：

```bash
wasm2wat markdown.wasm --enable-multi-value > markdown.wat
```

*注意：`--enable-multi-value`选项提供对多个返回值函数的支持，这对于反编译`markdown.wasm`模块是必须的。*

<!--### What the module needs from a host-->

### 模块需要host提供的支持

模块的`import`方式定义了host应为模块提供哪些功能，下面是`markdown`模块的`import`段：


```
(import "wasi_unstable" "fd_write" (func $fd_write (param i32 i32 i32 i32) (result i32)))
(import "wasi_unstable" "random_get" (func $random_get (param i32 i32) (result i32)))
```

该段申明告诉我们该模块需要host提供两个函数的接口：`fd_write`和`random_get`。
这两个函数实际上来自于具有明确行为定义的[WebAssembly System Interface](https://github.com/WebAssembly/WASI)（简称WASI）函数：`fd_write`用于将数据写入特定的文件描述符中，`random_get`将用随机数据填充某个缓冲区。

很快我们将为.NET的host环境实现这些函数，但更重要的是要明白**模块只能从host调用这些函数**，host可以决定如何实现这些函数甚至是是否实现这些函数。


### 模块为主机提供了怎样的功能

模块的export段定义了它为host提供的功能函数，以下`markdown`模块的export段：

```
(export "memory" (memory 0))
(export "render" (func $render_multivalue_shim))
(export "__wbindgen_malloc" (func $__wbindgen_malloc))
(export "__wbindgen_realloc" (func $__wbindgen_realloc))
(export "__wbindgen_free" (func $__wbindgen_free))

...

(func $render_multivalue_shim (param i32 i32) (result i32 i32) ...)
(func $__wbindgen_malloc (param i32) (result i32) ...)
(func $__wbindgen_realloc (param i32 i32 i32) (result i32) ...)
(func $__wbindgen_free (param i32 i32) ...)
```

首先，模块export了它自身的`memory`内存段，wasm内存是模块可访问的线性地址空间，**并且是模块可以读写的唯一内存区域**。
由于该模块无法直接访问host地址空间的任何其他区域内存，因此这段export的内存就是host与wasm模块交换数据的区域。

其次，模块export了我们用Rust实现的`render`函数，
但是这里有个问题是，为什么在前面Rust实现的函数只有一个参数和一个返回值，而wasm对应的函数有两个参数和两个返回值？

在Rust中，当编译为wasm时，字符串切片类型（`&str`）和字符串（`String`）均表示为初地址和长度（以字节为单位）对的形式。因此，wasm版本的函数由于更底层，便直接采用了这种底层的初地址和长度对形式来表示参数和返回值。值得注意的是，这里的初地址表示的是export内存中的整数字节偏移量。

那么我们回头看之前的代码，由于Rust代码返回一个`String`，它是一个*owned*自有类型，因此`render`的调用者负责释放包含渲染字符串的返回内存值。

在.NET的host的实现过程中，我们将逐一讨论其余的export项。

## 创建.NET工程

我们使用[.NET Core SDK](https://dotnet.microsoft.com/download)来创建.NET Core工程，所以请确保系统已安装了**3.0或更高版本**的.NET Core SDK。

为工程创建一个新的目录：

```
mkdir WasmtimeDemo
cd WasmtimeDemo
```

接下来，在目录中创建.NET Core命令行工程：

```
dotnet new console
```

最后，添加对[Wasmtime NuGet包](https://www.nuget.org/packages/Wasmtime)的依赖关系：

```
dotnet add package wasmtime --version 0.8.0-preview2
```

现在，我们已经做好使用Wasmtime的.NET AP来加载并执行markdown模块的准备了。

## 为wasm导入.NET代码

为wasm导入.NET实现的函数，跟.NET中实现[IHost](https://peterhuene.github.io/wasmtime.net/api/Wasmtime.IHost.html)接口一样简单。只需一个公有的[Instance]属性来表示和host绑定的wasm模块。

[Import](https://peterhuene.github.io/wasmtime.net/api/Wasmtime.ImportAttribute.html)属性被用于标记函数和域，正如wasm模块中的import那样。

我们之前提到，模块需要从host环境中import两个函数：`fd_write`和`random_get`，所以接下来对这两个函数进行实现：


在工程目录中创建一个名为`Host.cs`的文件，并添加如下的代码：

```csharp
using System.Security.Cryptography;
using Wasmtime;

namespace WasmtimeDemo
{
    class Host : IHost
    {
        // These are from the current WASI proposal.
        const int WASI_ERRNO_NOTSUP = 58;
        const int WASI_ERRNO_SUCCESS = 0;

        public Instance Instance { get; set; }

        [Import("fd_write", Module = "wasi_unstable")]
        public int WriteFile(int fd, int iovs, int iovs_len, int nwritten)
        {
            return WASI_ERRNO_NOTSUP;
        }

        [Import("random_get", Module = "wasi_unstable")]
        public int GetRandomBytes(int buf, int buf_len)
        {
            _random.GetBytes(Instance.Externs.Memories[0].Span.Slice(buf, buf_len));
            return WASI_ERRNO_SUCCESS;
        }

        private RNGCryptoServiceProvider _random = new RNGCryptoServiceProvider();
    }
}
```

`fd_write`实现仅仅只是简单地返回一个错误，表示不支持该操作。它可被模块用于将错误代码写入`stderr`中，在此demo中则永远不会发生。

`random_get`的实现使用的是随机字节填充请求缓冲区的方式。它将代表整个模块export内存的[`Span`](https://peterhuene.github.io/wasmtime.net/api/Wasmtime.Memory.html#Wasmtime_Memory_Span)切片，以便.NET的实现可以*直接*写入请求的缓冲区，而无需进行任何的中间复制操作。Rust标准库中`HashMap`的实现正是通过调用`random_get`函数的方式实现。

以上就是使用Wasmtime的.NET API将.NET函数import到wasm模块的全部步骤。不过，在加载wasm模块并在.NET使用它们之前，我们需要讨论如何将字符串作为参数，将其从.NET的host传递到`render`函数中。

<!--# Being a good host-->
## 良好的宿主环境

<!--Based on the exports of the module, we know it exports a memory. From the host’s perspective, think of a WebAssembly module’s exported memory as being granted access to the address space of a foreign process, even though the module shares the same process of the host itself.-->

基于模块的export，我们知道它export了一块*memory*区域。
从host的角度上来看，即使该模块与host本身共享相同的进程内存，也可以将wasm模块的export内存授权为对外部进程地址空间的权限。

<!--If you randomly write data to a foreign address space, Bad Things Happen™ because it’s quite easy to corrupt the state of the other program and cause undefined behavior, such as a crash or the total protonic reversal of the universe. So how can a host pass data to the WebAssembly module in a safe manner?-->

<!--Internally the Rust program uses a memory allocator to manage its memory. So, for .NET to be a good host to the WebAssembly module, it must also use the same memory allocator when allocating and freeing memory accessible to the WebAssembly module.-->

<!--Thankfully, wasm-bindgen, used by the Rust program to export itself as WebAssembly, also exported two functions for that purpose: __wbindgen_malloc and __wbindgen_free. These two functions are essentially malloc and free from C, except __wbindgen_free needs the size of the previous allocation in addition to the memory address.-->

<!--With this in mind, let us write a simple wrapper for these exported functions in C# so we can easily allocate and free memory accessible to the WebAssembly module.-->

<!--Create a file named Allocator.cs in the project directory and add the following content:-->

如果你将数据随机写入外部地址空间，则会发生意想不到的后果，因为它很容易对其他程序的状态造成破坏并引起未定义的行为，例如程序崩溃或比特值的反转。
那么主机应如何以安全的方式将数据传递到wasm模块中呢？

Rust程序在内部使用内存分配器来管理其内存，因此，为了使.NET成为wasm模块的良好宿主，在分配和释放wasm模块可访问的内存时，必须使用相同的内存分配器。

值得庆幸的是，Rust程序用来将自身导出为wasm模块的[wasm-bindgen](https://rustwasm.github.io/docs/wasm-bindgen)工具也为此export了两个函数：`__wbindgen_malloc`和`__wbindgen_free`。
除了`__wbindgen_free`需要知道内存地址之外，还需知道之前分配的内存大小之外，这两个函数本质上和C语言的`malloc`和`free`函数一样。

考虑到这一点，让我们为C#编写这些export函数的一个简单的封装，以便我们可以轻松分配和释放wasm模块可访问的内存大小。因此，在工程目录中创建一个名为`Allocator.cs`的文件，并添加如下代码：

```csharp
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using Wasmtime.Externs;

namespace WasmtimeDemo
{
    class Allocator
    {
        public Allocator(ExternMemory memory, IReadOnlyList<ExternFunction> functions)
        {
            _memory = memory ??
                throw new ArgumentNullException(nameof(memory));

            _malloc = functions
                .Where(f => f.Name == "__wbindgen_malloc")
                .SingleOrDefault() ??
                    throw new ArgumentException("Unable to resolve malloc function.");

            _free = functions
                .Where(f => f.Name == "__wbindgen_free")
                .SingleOrDefault() ??
                    throw new ArgumentException("Unable to resolve free function.");
        }

        public int Allocate(int length)
        {
            return (int)_malloc.Invoke(length);
        }

        public (int Address, int Length) AllocateString(string str)
        {
            var length = Encoding.UTF8.GetByteCount(str);

            int addr = Allocate(length);

            _memory.WriteString(addr, str);

            return (addr, length);
        }

        public void Free(int address, int length)
        {
            _free.Invoke(address, length);
        }

        private ExternMemory _memory;
        private ExternFunction _malloc;
        private ExternFunction _free;
    }
}
```

这段代码虽然看起来很复杂，但它所做的就是从模块中按名称查找所需的export函数，并将它们封装在易于使用的接口中。我们将使用该辅助`Allocator`类将输入字符串分配给export的`render`函数。

现在，我们准备开始渲染markdown。

## 渲染markdown

在工程目录中打开`Program.cs`，并将其替换为以下内容：

```csharp
using System;
using System.Linq;
using Wasmtime;

namespace WasmtimeDemo
{
    class Program
    {
        const string MarkdownSource = 
            "# Hello, `.NET`! Welcome to **WebAssembly** with [Wasmtime](https://wasmtime.dev)!";

        static void Main()
        {
            using var engine = new Engine();

            using var store = engine.CreateStore();

            using var module = store.CreateModule("markdown.wasm");

            using var instance = module.Instantiate(new Host());

            var memory = instance.Externs.Memories.SingleOrDefault() ??
                throw new InvalidOperationException("Module must export a memory.");

            var allocator = new Allocator(memory, instance.Externs.Functions);

            (var inputAddress, var inputLength) = allocator.AllocateString(MarkdownSource);

            try
            {
                object[] results = (instance as dynamic).render(inputAddress, inputLength);

                var outputAddress = (int)results[0];
                var outputLength = (int)results[1];

                try
                {
                    Console.WriteLine(memory.ReadString(outputAddress, outputLength));
                }
                finally
                {
                    allocator.Free(outputAddress, outputLength);
                }
            }
            finally
            {
                allocator.Free(inputAddress, inputLength);
            }
        }
    }
}
```

让我们一步步地看看这段代码做了哪些工作：

1. 创建`Engine`对象，该`Engine`类代表了Wasmtime运行时本身。运行时支持从.NET加载和执行wasm模块；

2. 然后创建`Store`对象，这个类是存放所有wasm对象（例如模块及其实例）的地方。`Engine`中可以有多个`Store`，但它们的关联对象不能相互影响；

3. 接下来它从磁盘存储的`markdown.wasm`文件中创建`Module`对象。
`Module`代表wasm模块本身的数据，例如它import和export的数据。一个模块可以具有一个或多个*实例*，实例化是wasm模块的*运行时*的表示形式。
它将模块的wasm指令编译为当前*CPU体系结构*的指令，分配模块可访问的内存，以及绑定从主机import的函数；

4. 它使用我们之前实现的`Host`类来实例化模块，绑定作为import项的.NET函数；

5. 查找到模块export的内存区域；

6. 创建一个分配器，然后为我们需要渲染的markdown内容分配一个字符串；

7. 以输入字符串为参数，通过将实例转换为`dynamic`的方式调用`render`函数。这本是C#的一项特性，在运行时动态绑定函数，可以将其简单地视为搜索export的并调用`render`函数的快捷方式；
   
8. 通过从wasm模块export的内存中读取返回的字符串，输出渲染后的HTML；
9. 最后，释放分配的输入字符串和Rust提供给我们的返回字符串。

就是这样的实现，然后继续运行代码。


## 运行代码

<!--
Before we can run the program, we need to copy markdown.wasm to the project directory, as this is where we’ll run the program from. You can find the markdown.wasm file in the target/wasm32-wasi/release directory from where you built it.

From the Program.cs source above, we see that the program hard-coded some Markdown to render:
-->

在运行程序之前，需要将`markdown.wasm`复制到工程目录中，因为它是我们实际运行程序的地方。
可以在构建目录的`target/wasm32-wasi/release`位置中找到该`markdown.wasm`文件。


从上面的`Program.cs`源码中，我们看到该程序对一些markdown进行了硬编码的渲染：

```markdown
# Hello, `.NET`! Welcome to **WebAssembly** with [Wasmtime](https://wasmtime.dev)!
```

运行程序，将其渲染为HTM格式L：

```bash
dotnet run
```

如果一切正常，应该会出现下面的结果：

```html
<h1>Hello, <code>.NET</code>! Welcome to <strong>WebAssembly</strong> with <a href="https://wasmtime.dev">Wasmtime</a>!</h1>
```

<!-- 

# What’s next for Wasmtime for .NET?
That was a surprisingly large amount of C# code that was necessary to implement this demo, wasn’t it?

There are two major features we have planned that will help simplify this: 
-->

## Wasmtime for .NET的下一步计划是什么？

从这里例子中，我们可以看到，现在实现该demo还需大量的C#代码，不是吗？

我们计划了从两个主要的功能点来简化代码实现：

<!-- Exposing Wasmtime’s WASI implementation to .NET (and other languages)
In our implementation of Host above, we had to manually implement fd_write and random_get, which are WASI functions.

Wasmtime itself has a WASI implementation, but currently it isn’t accessible to the .NET API.

Once the .NET API can access and configure the WASI implementation of Wasmtime, there will no longer be a need for .NET hosts to provide their own implementation of WASI functions.

Implementing interface types for .NET

As discussed earlier, WebAssembly interface types enable a more idiomatic integration of WebAssembly with a hosting programming language.

Once the .NET API implements the interface types proposal, there shouldn’t be a need to create an Allocator class like the one we implemented.

Instead, functions that use types like string should simply work without having to write any glue code in .NET. -->


*  **将Wasmtime的WASI实现开放给.NET和其他语言**
   
   在上面`Host`的实现中，必须手动去编写`fd_write`和`random_get`，但它们实际上是WASI中已有的函数。
   
   Wasmtime本身包含了WASI的实现，但只是目前无法通过.NET的API进行访问。
   
   一旦.NET的API可以访问和配置Wasmtime的WASI实现版本，则.NET的host环境将无需提供自己的实现。


* **实现.NET的接口类型**
  
  前面提到，wasm接口类型可以使wasm更加自然地与托管编程语言进行集成。
  
  一旦.NET的API实现了通过后的接口类型提案，便无需像前面那样去还要创建一个辅助功能的`Allocator`类。
  
  相反，使用诸如字符串等类型的函数可很容易办到，而不必在.NET中编写任何粘合代码。


<!-- The hope, then, is that this is what it might look like in the future to implement this demo from .NET: -->
所以希望将来该demo是这样在.NET中实现的：

```csharp
using System;
using Wasmtime;

namespace WasmtimeDemo
{
    interface Markdown
    {
        string Render(string input);
    }

    class Program
    {
        const string MarkdownSource =
            "# Hello, `.NET`! Welcome to **WebAssembly** with [Wasmtime](https://wasmtime.dev)!";

        static void Main()
        {
            using var markdown = Module.Load<Markdown>("markdown.wasm");

            Console.WriteLine(markdown.Render(MarkdownSource));
        }
    }
}
```

<!-- I think we can all agree that looks so much better! -->

我们都认为这样看起来好多了。

<!-- That’s a wrap!
This is the exciting beginning of using WebAssembly outside of the web browser from many different programming environments, including Microsoft’s .NET platform.

If you’re a .NET developer, we hope you’ll join us on this journey!

The .NET demo code from this article can be found in the Wasmtime Demos repository. -->


## 结束语

这是在Web浏览器之外利用不同的编程环境（包括微软的.NET平台）使用wasm的兴奋之旅的开始。

如果你是.NET开发者，我们希望您能加入我们的旅程！

*本文的.NET示例代码可以在[Wasmtime示例代码库](https://github.com/bytecodealliance/wasmtime-demos/tree/master/dotnet)中找到。*

*（译者注：本文原地址为 https://hacks.mozilla.org/2019/12/using-webassembly-from-dotnet-with-wasmtime/，原作者为 [Peter Huene](https://hacks.mozilla.org/author/phuenemozilla-com/)）*
