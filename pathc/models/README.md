# Path C model weights (not committed)

Download pinned files locally; hashes are in `../VERSIONS.md`.

```bash
curl -fL -o sd_turbo-f16-q8_0.gguf \
  https://huggingface.co/Green-Sky/SD-Turbo-GGUF/resolve/main/sd_turbo-f16-q8_0.gguf
curl -fL -o taesd.safetensors \
  https://huggingface.co/madebyollin/taesd/resolve/main/diffusion_pytorch_model.safetensors
shasum -a 256 sd_turbo-f16-q8_0.gguf taesd.safetensors
```
