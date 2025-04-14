<div align="center">

<p>
  <a href="https://repl.hakojs.com">
    <img width="500" alt="Hako logo" src="./assets/banner.png" />
  </a>
  <p>Hako (ha-ko) or 箱 means “box” in Japanese. </p>
</p>

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0.txt)


Hako is a embeddable, lightweight, secure, high-performance JavaScript engine. It is a fork of PrimJS; Hako has full support for ES2019 and later ESNext features, and offers superior performance and a better development experience when compared to QuickJS. 

</div>

## What makes it secure?

Hako compiles down to WebAssembly, a memory-safe, sandboxed execution environment. This means even though Hako is written in C/C++, programs it is embedded in have an extra layer of security from memory corruption attacks. Hako also has a built-in sandboxing mechanism in the form of VMContext which allows you to restrict the capabilities of JavaScript code. 

A number of APIs are exposed to limit the amount of memory and 'gas' a script can consume before it is terminated, and development follows an opinionated 'fail-fast' design for bailing out of potentially unstable code that could consume or block I/O. Combining all of these, you can run hundreds of VMs in parallel on a single machine.

![](./assets//hakostress.gif)


## What makes it embeddable?

Hako does not use Emscripten to compile down to WebAssembly; so long as your language of choice has a WebAssembly runtime, you can embed Hako in it by implementing the necessary imports. You can see an example of embedding Hako in Go [here](https://gist.github.com/andrewmd5/197efb527ef40131c34ca12fd6d0a61e).

It is also incredibly tiny. The release build is ~800KB.

## What makes it fast?

Hako is a fork of [PrimJS](https://github.com/lynx-family/primjs), which in sythentic benchmarks shows performance gains of 28% over QuickJS. Compiling to WebAssembly has no noticable impact on performance as the amazing JIT compilers of JavaScriptCore/Bun, V8/NodeJS, and Wasmtime allow code to run at near-native speeds. You can enable profiling in Hako to see how your code is performing.

## Notice

This project is still in early access - documentation is a work in progress, and the API/ABI should not be considered stable. If you wish to contribute, please do so by opening an issue or a pull request for further discussion. Your feedback is greatly appreciated.

You can find the intitial reference implementation of Hako in TypeScript [here](./embedders/ts/README.md).

For further reading and to get a sense of the roadmap see the initial blog post [here](https://andrewmd5.com/posts/2023-10-01-hako/).