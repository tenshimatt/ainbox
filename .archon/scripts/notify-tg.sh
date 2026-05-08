#!/usr/bin/env bash
# notify-tg.sh — send a Telegram alert via the Hermes bot to Matt's DM.
#
# Usage:
#   notify-tg.sh "<message>"                  # plain text
#   notify-tg.sh -e GATE_PR "..."             # tagged event
#   echo "msg" | notify-tg.sh -                # stdin mode
#
# Reads TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID from env, falling back to
# /etc/archon/notify.env on CT 111 (chmod 600). NEVER commit the token.
#
# Designed for the Pandomagic dark-factory: every gate hit, test red,
# PR open, halt, or $-spend threshold pings Matt. Silent successes don't.
set -euo pipefail

EVENT=""
if [[ "${1:-}" == "-e" ]]; then EVENT="$2"; shift 2; fi

if [[ "${1:-}" == "-" ]]; then MSG="$(cat)"; else MSG="${1:-}"; fi
[[ -z "$MSG" ]] && { echo "notify-tg: empty message" >&2; exit 2; }

# Resolve credentials
if [[ -z "${TELEGRAM_BOT_TOKEN:-}" || -z "${TELEGRAM_CHAT_ID:-}" ]]; then
  if [[ -r /etc/archon/notify.env ]]; then
    set -a; . /etc/archon/notify.env; set +a
  fi
fi
: "${TELEGRAM_BOT_TOKEN:?TELEGRAM_BOT_TOKEN missing}"
: "${TELEGRAM_CHAT_ID:?TELEGRAM_CHAT_ID missing}"

# Tag with project + event + ticket if available
PREFIX="🏭 <b>Ainbox</b>"
[[ -n "$EVENT" ]] && PREFIX="$PREFIX · <code>$EVENT</code>"
[[ -n "${ARCHON_TICKET_ID:-}" ]] && PREFIX="$PREFIX · ticket <code>${ARCHON_TICKET_ID}</code>"

HOST="$(hostname -s 2>/dev/null || echo harness)"
FOOTER="<i>via $HOST · $(date -u +%H:%M:%SZ)</i>"

# Telegram caps message size at 4096 chars; truncate body to fit
HEAD_LEN=$(( ${#PREFIX} + ${#FOOTER} + 100 ))
MAX_BODY=$(( 4096 - HEAD_LEN ))
if [[ ${#MSG} -gt $MAX_BODY ]]; then
  MSG="${MSG:0:$MAX_BODY}…"
fi

PAYLOAD="${PREFIX}
${MSG}

${FOOTER}"

curl -s --max-time 10 \
  "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
  --data-urlencode "text=${PAYLOAD}" \
  -d parse_mode=HTML \
  -d disable_web_page_preview=true \
  > /dev/null || { echo "notify-tg: send failed" >&2; exit 3; }
