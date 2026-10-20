<!-- Source: https://ui.shadcn.com/docs/components/base/tooltip + registry example tooltip-demo (fetched 2026-10-20). Official usage, composition and API for §19. -->

# tooltip



## [Installation#](#installation)

### Run the following command:

```
pnpm dlx shadcn@latest add tooltip
```

### Add the `TooltipProvider` to the root of your app.

app/layout.tsx

```
import { TooltipProvider } from "@/components/ui/tooltip"
 
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  )
}
```

## [Usage#](#usage)

```
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
```

```
<Tooltip>
  <TooltipTrigger>Hover</TooltipTrigger>
  <TooltipContent>
    <p>Add to library</p>
  </TooltipContent>
</Tooltip>
```

## [Composition#](#composition)

Use the following composition to build a `Tooltip`:

```
Tooltip
├── TooltipTrigger
└── TooltipContent
```

## [Side#](#side)

Use the `side` prop to change the position of the tooltip.

```
import { Button } from "@/components/ui/button"
import {
  Tooltip,
```

## [With Keyboard Shortcut#](#with-keyboard-shortcut)

```
import { SaveIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
```

## [Disabled Button#](#disabled-button)

Show a tooltip on a disabled button by wrapping it with a span.

```
import { Button } from "@/components/ui/button"
import {
  Tooltip,
```

## [RTL#](#rtl)

To enable RTL support in shadcn/ui, see the [RTL configuration guide](/docs/rtl).

```
"use client"

import {
```

## [API Reference#](#api-reference)

See the [Base UI Tooltip](https://base-ui.com/react/components/tooltip#api-reference) documentation.

[Toggle Group](/docs/components/base/toggle-group)[Trace](/docs/components/base/trace)

On This Page

[Installation](#installation)[Usage](#usage)[Composition](#composition)[Side](#side)[With Keyboard Shortcut](#with-keyboard-shortcut)[Disabled Button](#disabled-button)[RTL](#rtl)[API Reference](#api-reference)

Deploy your shadcn/ui app on Vercel

Trusted by OpenAI, Sonos, Adobe, and more.

Vercel provides tools and infrastructure to deploy apps and features at scale.

[Deploy to Vercel](https://vercel.com/new?utm_source=shadcn_site&utm_medium=web&utm_campaign=docs_cta_deploy_now_callout)

## Registry example

# Usage Examples

Found 2 examples matching "tooltip-demo":
## Example: tooltip-demo
### Code (registry/new-york-v4/examples/tooltip-demo.tsx):

```tsx
import { Button } from "@/registry/new-york-v4/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/registry/new-york-v4/ui/tooltip"

export default function TooltipDemo() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="outline">Hover</Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>Add to library</p>
      </TooltipContent>
    </Tooltip>
  )
}

```

---

## Example: chart-tooltip-demo
### Code (registry/new-york-v4/examples/chart-tooltip-demo.tsx):

```tsx
"use client"

import * as React from "react"
import { cn } from "cn"

export default function Component() {
  return (
    <div className="grid aspect-video w-full max-w-md justify-center text-foreground md:grid-cols-2 [&>div]:relative [&>div]:flex [&>div]:h-[137px] [&>div]:w-[224px] [&>div]:items-center [&>div]:justify-center [&>div]:p-4">
      <div>
        <div className="absolute top-[45px] left-[-35px] z-10 text-sm font-medium">
          Label
        </div>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 193 40"
          width="50"
          height="12"
          fill="none"
          className="absolute top-[50px] left-[5px] z-10"
        >
          <g clipPath="url(#a)">
            <path
              fill="currentColor"
              d="M173.928 21.13C115.811 44.938 58.751 45.773 0 26.141c4.227-4.386 7.82-2.715 10.567-1.88 21.133 5.64 42.9 6.266 64.457 7.101 31.066 1.253 60.441-5.848 89.183-17.335 1.268-.418 2.325-1.253 4.861-2.924-14.582-2.924-29.165 2.089-41.845-3.76.212-.835.212-1.879.423-2.714 9.51-.627 19.231-1.253 28.742-2.089 9.51-.835 18.808-1.88 28.318-2.506 6.974-.418 9.933 2.924 7.397 9.19-3.17 8.145-7.608 15.664-11.623 23.391-.423.836-1.057 1.88-1.902 2.298-2.325.835-4.65 1.044-7.186 1.67-.422-2.088-1.479-4.386-1.268-6.265.423-2.506 1.902-4.595 3.804-9.19Z"
            />
          </g>
          <defs>
            <clipPath id="a">
              <path fill="currentColor" d="M0 0h193v40H0z" />
            </clipPath>
          </defs>
        </svg>
        <TooltipDemo
          label="Page Views"
          payload={[
            { name: "Desktop", value: 186, fill: "var(--chart-1)" },
            { name: "Mobile", value: 80, fill: "var(--chart-2)" },
          ]}
          className="w-[8rem]"
        />
      </div>
      <div className="items-end">
        <div className="absolute top-[0px] left-[122px] z-10 text-sm font-medium">
          Name
        </div>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="35"
          height="42"
          fill="none"
          viewBox="0 0 122 148"
          className="absolute top-[10px] left-[85px] z-10 -scale-x-100"
        >
          <g clipPath="url(#ab)">
            <path
              fill="currentColor"
              d="M0 2.65c6.15-4.024 12.299-2.753 17.812-.847a115.56 115.56 0 0 1 21.84 10.59C70.4 32.727 88.849 61.744 96.483 97.54c1.908 9.108 2.544 18.639 3.817 29.017 8.481-4.871 12.934-14.402 21.416-19.909 1.061 4.236-1.06 6.989-2.756 9.319-6.998 9.531-14.207 19.062-21.63 28.382-3.604 4.448-6.36 4.871-10.177 1.059-8.058-7.837-12.935-17.368-14.42-28.382 0-.424.636-1.059 1.485-2.118 9.118 2.33 6.997 13.979 14.843 18.215 3.393-14.614.848-28.593-2.969-42.149-4.029-14.19-9.33-27.746-17.812-39.82-8.27-11.86-18.66-21.392-30.11-30.287C26.93 11.758 14.207 6.039 0 2.65Z"
            />
          </g>
          <defs>
            <clipPath id="ab">
              <path fill="currentColor" d="M0 0h122v148H0z" />
            </clipPath>
          </defs>
        </svg>
        <TooltipDemo
          label="Browser"
          hideLabel
          payload={[
            { name: "Chrome", value: 1286, fill: "var(--chart-3)" },
            { name: "Firefox", value: 1000, fill: "var(--chart-4)" },
          ]}
          indicator="dashed"
          className="w-[8rem]"
        />
      </div>
      <div className="hidden! md:flex!">
        <TooltipDemo
          label="Page Views"
          payload={[{ name: "Desktop", value: 12486, fill: "var(--chart-3)" }]}
          className="w-[9rem]"
          indicator="line"
        />
      </div>
      <div className="items-start! justify-start!">
        <div className="absolute top-[60px] left-[50px] z-10 text-sm font-medium">
          Indicator
        </div>
        <TooltipDemo
          label="Browser"
          hideLabel
          payload={[{ name: "Chrome", value: 1286, fill: "var(--chart-1)" }]}
          indicator="dot"
          className="w-[8rem]"
        />
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="15"
          height="34"
          fill="none"
          viewBox="0 0 75 175"
          className="absolute top-[38px] left-[30px] z-10 rotate-[-40deg]"
        >
          <g clipPath="url(#abc)">
            <path
              fill="currentColor"
              d="M20.187 175c-4.439-2.109-7.186-2.531-8.032-4.008-3.17-5.484-6.763-10.968-8.454-17.084-5.073-16.242-4.439-32.694-1.057-49.146 5.707-28.053 18.388-52.942 34.24-76.565 1.692-2.531 3.171-5.063 4.862-7.805 0-.21-.211-.632-.634-1.265-4.65 1.265-9.511 2.53-14.161 3.585-2.537.422-5.496.422-8.032-.421-1.48-.422-3.593-2.742-3.593-4.219 0-1.898 1.48-4.218 2.747-5.906 1.057-1.054 2.96-1.265 4.65-1.687C35.406 7.315 48.088 3.729 60.98.776c10.99-2.53 14.584 1.055 13.95 11.812-.634 11.18-.846 22.358-1.268 33.326-.212 3.375-.846 6.96-1.268 10.757-8.878-4.007-8.878-4.007-12.048-38.177C47.03 33.259 38.153 49.289 29.91 65.741 21.667 82.193 16.17 99.49 13.212 117.84c-2.959 18.984.634 36.912 6.975 57.161Z"
            />
          </g>
          <defs>
            <clipPath id="abc">
              <path fill="currentColor" d="M0 0h75v175H0z" />
            </clipPath>
          </defs>
        </svg>
      </div>
    </div>
  )
}

function TooltipDemo({
  indicator = "dot",
  label,
  payload,
  hideLabel,
  hideIndicator,
  className,
}: {
  label: string
  hideLabel?: boolean
  hideIndicator?: boolean
  indicator?: "line" | "dot" | "dashed"
  payload: {
    name: string
    value: number
    fill: string
  }[]
  nameKey?: string
  labelKey?: string
} & React.ComponentProps<"div">) {
  const tooltipLabel = hideLabel ? null : (
    <div className="font-medium">{label}</div>
  )

  if (!payload?.length) {
    return null
  }

  const nestLabel = payload.length === 1 && indicator !== "dot"

  return (
    <div
      className={cn(
        "grid min-w-[8rem] items-start gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl transition-all ease-in-out hover:-translate-y-0.5",
        className
      )}
    >
      {!nestLabel ? tooltipLabel : null}
      <div className="grid gap-1.5">
        {payload.map((item, index) => {
          const indicatorColor = item.fill

          return (
            <div
             