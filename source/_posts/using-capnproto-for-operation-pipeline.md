---
title: 利用Capnproto优化RPC组合操作
date: 2018-08-13 08:44:34
tags: [云计算, Capnproto, RPC]
categories: 中文
---

<!-- *原文地址： [http://blog.zhangpf.com/2018/08/13/using-capnproto-for-operation-pipeline/](http://blog.zhangpf.com/2018/08/13/using-capnproto-for-operation-pipeline/)* -->

## Capnproto简介

Capnproto是一款号称具有"infinity faster"的RPC框架。你可以认为它是JSON，只是它直
接生成了二进制格式的消息；你可以认为它是Protocol Buffer，只是它更快而已。Capnproto
有多快呢？它[主页][mainpage]上有张图是这样的：

![Capnproto宣传的"infinity faster"][capnproto]

不过连官方也表示这样的比较是不公平的，因为它仅测量了在内存中编码和解码消息的时间。
Capnproto这里获得了满分，因为它根本就没有编码/解码步骤，所以我认为更合理的性能对比如下图所示。

![和其他框架的对比（1）][performance1]
![和其他框架的对比（2）][performance2]

相比之下，还是相当快的。Capnproto编码既适用于数据交换格式，也适用于在内存中表示，
因此一旦构建了结构，便可以直接将字节写入磁盘中。

## Schema语言

Capnproto通过自定义语言来实现RPC接口和相应的操作，在这一点上和ProtoBuf以及Thrift
很像，如果你用过这两种语言，那么对此应该很熟悉。例如：
```
@0xdbb9ad1f14bf0b36;  # unique file ID, generated by `capnp id`

struct Person {
  name @0 :Text;
  birthdate @3 :Date;

  email @1 :Text;
  phones @2 :List(PhoneNumber);

  struct PhoneNumber {
    number @0 :Text;
    type @1 :Type;

    enum Type {
      mobile @0;
      home @1;
      work @2;
    }
  }
}

struct Date {
  year @0 :Int16;
  month @1 :UInt8;
  day @2 :UInt8;
}
```

其内置的类型包括：
* Void: Void
* Boolean: Bool
* Integers: Int8, Int16, Int32, Int64
* Unsigned integers: UInt8, UInt16, UInt32, UInt64
* Floating-point: Float32, Float64
* Blobs: Text, Data
* Lists: List(T)

以及常量，`struct`，`union`，`enum`，`group`等组合结构。另外，接口函数还支持泛
型和泛函数等，可以说是相当强大。具体的语法请参考[官方文档][language]。

## 优化RPC组合操作

不过我认为，Capnproto的优势还是体现在优化RPC组合操作上。

我们都知道，接口文件（Interface）描述了客户端和服务端之间所有的交互方式。设想一种
场景，随着一个系统的不断演化，客户端新的行为需要之前从来没有过的接口操作，而这个时候，
服务端相应的RPC方法，以及接口文件无法马上得到，而这个操作又恰恰可以是多个旧操作的组合。

举个例子，服务端维护一个数据库，保存的是某个网站上所有博客的内容，暴露给客户端的RPC操作仅有：
* 根据ID获取一篇博客信息: `get(key)`
* 根据ID删除博客内容： `remove(key)`
* 根据ID存储相应博客信息： `store(key, blog)`

现在客户端需要马上实现一个新的操作：copy某个博文从key1到key2，`copy(key1, key2)`。
在接口不变的情况下，我们当然可以先用`get`将blog传回客户端，再用新ID和blog进行`store`操作。

不过在Capnproto框架下，可以采取不太一样的方式。Capnproto的RPC采取一种类似于`Promise`的方法，
将所有接口操作流水化，中间结果不用传回客户端，因此这样减少了一次中间结果的往返传递，同时也减少了调用延迟。

![Capnproto的RPC计算可以不用等待中间结果的返回][rpc-image]

也就是说，原来的需要如下方式实现的`copy`操作：

```
value = get(key1);
store(key2, value);
```

变成了类似如下的形式：

```
getPromise = get(key1);
storePromise = store(key2, getPromise);
storePromise.then(...);
```
这里的中间步骤，将不再有blog数据传输。

在本文接下来的部分，我将用代码片段演示capnp接口的实现过程。完整的示例代码，请查看[github仓库][repo]。

### capnp接口


为了使得客户端可以惰性地获取`get(key)`操作得结果，首先定义Blog信息的interface结构：

```
interface Blog {
    read @0 () -> (blog :Text);
}
```
Blog接口具有一个操作：`read()`，调用的结果是实际的blog数据。因此，`get`不再返回`:Text`
类型的数据，而是返回一个`:Blog`类型的接口。只有在调用这个接口的`read`函数之后才获取其中的值：

```
interface BlogStore {

    interface Blog {
        read @0 () -> (blog :Text);
    }

    get @0 (key :UInt64) -> (blog :Blog);
}
```

同时，为了使得`store(key, blog)`操作中的blog值，能够既支持从客户端传来的数据，又支持
上次`get`操作返回的Blog接口，需要定义一个Store结构体：

```
struct Store {
    union {
        blog @0 :Text;
        previousGet @1 :Blog;
    }
}
```

这个结构体中只有一个union项，表示可能的值是二者之一
（*capnp语言中的union不能单独定义，只能在struct中出现*）。
因此`store`操作的定义变成了如下形式：

```
store @1 (key :UInt64, blog :Store);
```

最后，我们再加上`remove(key)`操作的定义，整个`blogstore.capnp`文件的内容就是下面这个样子：

```
@0xf79af02aadd13d6d;

interface BlogStore {

    interface Blog {
        read @0 () -> (blog :Text);
    }

    struct Store {
        union {
            blog @0 :Text;
            previousGet @1 :Blog;
        }
    }

    get @0 (key :UInt64) -> (blog :Blog);

    store @1 (key :UInt64, blog :Store);

    remove @2 (key :UInt64);
}
```

利用capnp编译器编译`blogstore.capnp`，生成相应的`blogstore.capnp.h`和`blogstore.capnp.c++`：
```
capnpc -oc++ blogstore.capnp
```
在此基础上，还需要实现[客户端代码][client]和[服务端代码][server]，
具体的教程可以参考官方的[RPC教程][rpc]。

### 性能对比

设定所有的blog数据均是4096字节大小的UTF-8字符串数据。在AWS的c3.large主机上，
我的代码实现在不同网络结构下的性能对比：


| Operation          | Get   | Store | Remove | Copy  |
| :----------------: | :---: | :---: | :----: | :---: |
| Unix domain socket | 207µs | 161µs | 152µs  | 232µs |
| Loopback device    | 246µs | 163µs | 152µs  | 267µs |
| Local network      | 446µs | 372µs | 301µs  | 381µs |

一次`copy`操作所用的时间大致和`get`相当，但是远小于`get`和`store`之和。


[mainpage]: https://capnproto.org/index.html
[repo]: https://github.com/zhangpf/cloud-demos/tree/master/capnproto
[performance1]: https://github.com/thekvs/cpp-serializers/raw/master/images/time.png
[performance2]: https://github.com/thekvs/cpp-serializers/raw/master/images/time2.png
[capnproto]: https://capnproto.org/images/infinity-times-faster.png "The infinity faster of Capnproto"
[language]: https://capnproto.org/language.html。
[rpc-image]: https://capnproto.org/images/time-travel.png "The RPC procedure of Capnproto"
[rpc]: https://capnproto.org/cxxrpc.html
[client]: https://github.com/zhangpf/cloud-demos/blob/master/capnproto/client.cpp
[server]: https://github.com/zhangpf/cloud-demos/blob/master/capnproto/server.cpp
