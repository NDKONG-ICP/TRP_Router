#!/usr/bin/env bash
# Securely write trp-router/.env. Keys are typed at hidden prompts — not echoed, not in shell history.
cd "/Users/williambeck/TheRavenProject/Raven DAPP/trp-router" || { echo "cannot find trp-router"; exit 1; }
echo "Paste each key at its prompt, then press Enter. Input is hidden. Press Enter alone to skip one."
read -rsp "Cloudflare Account ID : " CA; echo
read -rsp "Cloudflare API Token  : " CT; echo
read -rsp "Groq API Key          : " GQ; echo
read -rsp "Gemini API Key        : " GM; echo
read -rsp "Anthropic API Key     : " AN; echo
cat > .env <<EOF
# trp-router/.env — free provider keys (gitignored)
CLOUDFLARE_ACCOUNT_ID=$CA
CLOUDFLARE_API_TOKEN=$CT
GROQ_API_KEY=$GQ
GEMINI_API_KEY=$GM
ANTHROPIC_API_KEY=$AN
EOF
echo
echo "Wrote .env (lengths only, no secrets shown):"
while IFS='=' read -r k v; do case "$k" in ''|\#*) continue;; esac; printf '  %-24s %s chars\n' "$k" "${#v}"; done < .env
