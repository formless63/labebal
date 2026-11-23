# @labebal/app

[labebal](https://github.com/formless63/labebal) as a module: the label designer
and printing screens as one React component, plus a fetch-standard server
handler for any Postgres database (through Drizzle).

```sh
npm install @labebal/app @labebal/core drizzle-orm
```

```ts
// server
import { createLabebalServer } from "@labebal/app/server";
export const labebal = createLabebalServer({ db, basePath: "/labels", user: async (req) => yourUser(req) });
// send every request under /labels/api/ to labebal.handler(request)
```

```tsx
// browser
import { LabebalApp } from "@labebal/app";
import "@labebal/app/styles.css"; // or @import "@labebal/app/tailwind.css" in a Tailwind 4 app
<LabebalApp basePath="/labels" chrome="embedded" />;
```

Guide: https://formless63.github.io/labebal/embedding
