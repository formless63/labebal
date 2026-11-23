# Get started

You need Docker on the machine that runs labebal, and **Chrome or Edge** on the
device that prints. Firefox and iPhones can open labebal but can't talk to
Bluetooth or USB printers.

## Run it

```sh
docker run -d --name labebal -p 3000:3000 -v labebal-data:/data --restart unless-stopped ghcr.io/formless63/labebal:latest
```

Open <http://localhost:3000>. A new labebal opens on the Label Muncher, so you
have something to print straight away.

Prefer compose? Save this as `compose.yaml` and run `docker compose up -d`:

```yaml
services:
  labebal:
    image: ghcr.io/formless63/labebal:latest
    restart: unless-stopped
    ports: ["3000:3000"]
    volumes: ["labebal-data:/data"]
volumes:
  labebal-data:
```

::: warning Other devices need HTTPS
Browsers only allow Bluetooth and USB on `localhost` or HTTPS pages. To print
from another device, put labebal behind a reverse proxy with a certificate. The
proxy is also what keeps strangers out: labebal has no login of its own. See
[Deploy](/deploy).
:::

## Print your first label

1. Click **Connect printer** and pick yours. For a Niimbot over Bluetooth, turn
   it on first and choose it in the browser's list.
2. Check **Label size** matches the roll in the printer. Rolls with an RFID tag
   are recognised.
3. Pick a label on the left, then **+** to add it to the queue.
4. Click **Print**.

## Where to go next

- [Print labels](/guide/print): queues, sizes, stock and printer settings.
- [Design labels](/guide/design): the editor and how designs reflow.
- [Labels from data](/guide/data): spreadsheets, rules and live sources.
- [Embed in your app](/embedding): labebal inside another React app.
