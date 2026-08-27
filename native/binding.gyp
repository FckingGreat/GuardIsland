{
  "targets": [
    {
      "target_name": "guard_native",
      "sources": [
        "src/addon.cpp",
        "src/message_loop.cpp",
        "src/process_watch.cpp"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "defines": [
        "NAPI_DISABLE_CPP_EXCEPTIONS",
        "UNICODE",
        "_UNICODE",
        "WIN32_LEAN_AND_MEAN"
      ],
      "libraries": [
        "-luser32",
        "-ladvapi32",
        "-lkernel32",
        "-lole32",
        "-loleaut32",
        "-lwbemuuid"
      ],
      "msvs_settings": {
        "VCCLCompilerTool": {
          "ExceptionHandling": 1,
          "AdditionalOptions": [ "/utf-8" ]
        }
      }
    }
  ]
}
