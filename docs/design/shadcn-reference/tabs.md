<!-- Source: https://ui.shadcn.com/docs/components/base/tabs + registry example tabs-demo (fetched 2026-10-20). Official usage, composition and API for §19. -->

# tabs



## [Installation#](#installation)

```
pnpm dlx shadcn@latest add tabs
```

## [Usage#](#usage)

```
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
```

```
<Tabs defaultValue="account" className="w-[400px]">
  <TabsList>
    <TabsTrigger value="account">Account</TabsTrigger>
    <TabsTrigger value="password">Password</TabsTrigger>
  </TabsList>
  <TabsContent value="account">Make changes to your account here.</TabsContent>
  <TabsContent value="password">Change your password here.</TabsContent>
</Tabs>
```

## [Composition#](#composition)

Use the following composition to build `Tabs`:

```
Tabs
├── TabsList
│   ├── TabsTrigger
│   └── TabsTrigger
├── TabsContent
└── TabsContent
```

## [Line#](#line)

Use the `variant="line"` prop on `TabsList` for a line style.

```
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

export function TabsLine() {
```

## [Vertical#](#vertical)

Use `orientation="vertical"` for vertical tabs.

```
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

export function TabsVertical() {
```

## [Disabled#](#disabled)

```
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

export function TabsDisabled() {
```

## [Icons#](#icons)

```
import { AppWindowIcon, CodeIcon } from "lucide-react"

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
```

## [RTL#](#rtl)

To enable RTL support in shadcn/ui, see the [RTL configuration guide](/docs/rtl).

```
"use client"

import * as React from "react"
```

## [API Reference#](#api-reference)

See the [Base UI Tabs](https://base-ui.com/react/components/tabs#api-reference) documentation.

## Registry example

# Usage Examples

Found 1 example matching "tabs-demo":
## Example: tabs-demo
### Code (registry/new-york-v4/examples/tabs-demo.tsx):

```tsx
import { AppWindowIcon, CodeIcon } from "lucide-react"

import { Button } from "@/registry/new-york-v4/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/registry/new-york-v4/ui/card"
import { Input } from "@/registry/new-york-v4/ui/input"
import { Label } from "@/registry/new-york-v4/ui/label"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/registry/new-york-v4/ui/tabs"

export default function TabsDemo() {
  return (
    <div className="flex w-full max-w-sm flex-col gap-6">
      <Tabs defaultValue="account">
        <TabsList>
          <TabsTrigger value="account">Account</TabsTrigger>
          <TabsTrigger value="password">Password</TabsTrigger>
        </TabsList>
        <TabsContent value="account">
          <Card>
            <CardHeader>
              <CardTitle>Account</CardTitle>
              <CardDescription>
                Make changes to your account here. Click save when you&apos;re
                done.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-6">
              <div className="grid gap-3">
                <Label htmlFor="tabs-demo-name">Name</Label>
                <Input id="tabs-demo-name" defaultValue="Pedro Duarte" />
              </div>
              <div className="grid gap-3">
                <Label htmlFor="tabs-demo-username">Username</Label>
                <Input id="tabs-demo-username" defaultValue="@peduarte" />
              </div>
            </CardContent>
            <CardFooter>
              <Button>Save changes</Button>
            </CardFooter>
          </Card>
        </TabsContent>
        <TabsContent value="password">
          <Card>
            <CardHeader>
              <CardTitle>Password</CardTitle>
              <CardDescription>
                Change your password here. After saving, you&apos;ll be logged
                out.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-6">
              <div className="grid gap-3">
                <Label htmlFor="tabs-demo-current">Current password</Label>
                <Input id="tabs-demo-current" type="password" />
              </div>
              <div className="grid gap-3">
                <Label htmlFor="tabs-demo-new">New password</Label>
                <Input id="tabs-demo-new" type="password" />
              </div>
            </CardContent>
            <CardFooter>
              <Button>Save password</Button>
            </CardFooter>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

```