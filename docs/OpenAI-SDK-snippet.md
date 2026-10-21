# OpenAI SDK → TRP Router (DRAFT — legal review pending)

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://127.0.0.1:8000/v1",  # local replica router_canister HTTP gateway
    api_key="local-dev",  # router-issued keys STAGED
)

# Image (utility credits — not an investment product)
img = client.images.generate(
    model="trp/image-standard",
    prompt="still life of chili peppers",
    size="1024x1024",
)
print(img.data[0].url)  # /blob/<sha256>
```

On-chain models (`trp/onchain-*`) return 503 until `vendor/llama_cpp_canister` is built (see VERSIONS.md).
