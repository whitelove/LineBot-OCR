const nextConfig = {
  serverExternalPackages: ["onnxruntime-node", "sharp", "pdf-to-img", "pdfjs-dist", "@napi-rs/canvas"],
  outputFileTracingIncludes: {
    "/api/webhook": [
      "./models/*",
      "./node_modules/pdfjs-dist/standard_fonts/**",
      "./node_modules/pdfjs-dist/cmaps/**",
      "./node_modules/pdfjs-dist/wasm/**",
      "./node_modules/@napi-rs/canvas-linux-x64-gnu/**",
      "./node_modules/onnxruntime-node/bin/napi-v6/linux/x64/*",
      "./node_modules/pdf-to-img/dist/**",
      "./node_modules/pdfjs-dist/legacy/build/*.mjs",
    ],
  },
  outputFileTracingExcludes: {
    "*": [
      "./node_modules/onnxruntime-node/bin/napi-v6/darwin/**",
      "./node_modules/onnxruntime-node/bin/napi-v6/win32/**",
      "./node_modules/onnxruntime-node/bin/napi-v6/linux/arm64/**",
      "./node_modules/onnxruntime-node/bin/**/libonnxruntime_providers_cuda.so",
      "./node_modules/onnxruntime-node/bin/**/libonnxruntime_providers_tensorrt.so",
      "./node_modules/@napi-rs/canvas-darwin-*/**",
      "./node_modules/@napi-rs/canvas-win32-*/**",
    ],
  },
};
export default nextConfig;
