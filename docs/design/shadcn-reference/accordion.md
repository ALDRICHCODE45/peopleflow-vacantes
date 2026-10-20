<!-- Source: https://ui.shadcn.com/docs/components/base/accordion + registry example accordion-demo (fetched 2026-10-20). Official usage, composition and API for §19. -->

# accordion



## [Installation#](#installation)

```
pnpm dlx shadcn@latest add accordion
```

## [Usage#](#usage)

```
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
```

```
<Accordion defaultValue={["item-1"]}>
  <AccordionItem value="item-1">
    <AccordionTrigger>Is it accessible?</AccordionTrigger>
    <AccordionContent>
      Yes. It adheres to the WAI-ARIA design pattern.
    </AccordionContent>
  </AccordionItem>
</Accordion>
```

## [Composition#](#composition)

Use the following composition to build an `Accordion`:

```
Accordion
├── AccordionItem
│   ├── AccordionTrigger
│   └── AccordionContent
└── AccordionItem
    ├── AccordionTrigger
    └── AccordionContent
```

## [Basic#](#basic)

A basic accordion that shows one item at a time. The first item is open by default.

```
import {
  Accordion,
  AccordionContent,
```

## [Multiple#](#multiple)

Use the `multiple` prop to allow multiple items to be open at the same time.

```
import {
  Accordion,
  AccordionContent,
```

## [Disabled#](#disabled)

Use the `disabled` prop on `AccordionItem` to disable individual items.

```
import {
  Accordion,
  AccordionContent,
```

## [Borders#](#borders)

Add `border` to the `Accordion` and `border-b last:border-b-0` to the `AccordionItem` to add borders to the items.

```
import {
  Accordion,
  AccordionContent,
```

## [Card#](#card)

Wrap the `Accordion` in a `Card` component.

```
import {
  Accordion,
  AccordionContent,
```

## [RTL#](#rtl)

To enable RTL support in shadcn/ui, see the [RTL configuration guide](/docs/rtl).

```
"use client"

import * as React from "react"
```

## [API Reference#](#api-reference)

See the [Base UI](https://base-ui.com/react/components/accordion#api-reference) documentation for more information.

## Registry example

# Usage Examples

Found 1 example matching "accordion-demo":
## Example: accordion-demo
### Code (registry/new-york-v4/examples/accordion-demo.tsx):

```tsx
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/registry/new-york-v4/ui/accordion"

export default function AccordionDemo() {
  return (
    <Accordion
      type="single"
      collapsible
      className="w-full"
      defaultValue="item-1"
    >
      <AccordionItem value="item-1">
        <AccordionTrigger>Product Information</AccordionTrigger>
        <AccordionContent className="flex flex-col gap-4 text-balance">
          <p>
            Our flagship product combines cutting-edge technology with sleek
            design. Built with premium materials, it offers unparalleled
            performance and reliability.
          </p>
          <p>
            Key features include advanced processing capabilities, and an
            intuitive user interface designed for both beginners and experts.
          </p>
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="item-2">
        <AccordionTrigger>Shipping Details</AccordionTrigger>
        <AccordionContent className="flex flex-col gap-4 text-balance">
          <p>
            We offer worldwide shipping through trusted courier partners.
            Standard delivery takes 3-5 business days, while express shipping
            ensures delivery within 1-2 business days.
          </p>
          <p>
            All orders are carefully packaged and fully insured. Track your
            shipment in real-time through our dedicated tracking portal.
          </p>
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="item-3">
        <AccordionTrigger>Return Policy</AccordionTrigger>
        <AccordionContent className="flex flex-col gap-4 text-balance">
          <p>
            We stand behind our products with a comprehensive 30-day return
            policy. If you&apos;re not completely satisfied, simply return the
            item in its original condition.
          </p>
          <p>
            Our hassle-free return process includes free return shipping and
            full refunds processed within 48 hours of receiving the returned
            item.
          </p>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}

```