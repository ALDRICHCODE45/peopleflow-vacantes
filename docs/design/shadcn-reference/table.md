<!-- Source: https://ui.shadcn.com/docs/components/base/table (read 2026-10-28), checked against installed src/components/ui/table.tsx. Official usage, composition and API for §19. -->

# Table

A responsive table component.

## Usage

```tsx
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

<Table>
  <TableCaption>A list of your recent invoices.</TableCaption>
  <TableHeader>
    <TableRow>
      <TableHead>Invoice</TableHead>
      <TableHead>Status</TableHead>
      <TableHead>Method</TableHead>
      <TableHead className="text-right">Amount</TableHead>
    </TableRow>
  </TableHeader>
  <TableBody>
    <TableRow>
      <TableCell className="font-medium">INV001</TableCell>
      <TableCell>Paid</TableCell>
      <TableCell>Credit Card</TableCell>
      <TableCell className="text-right">$250.00</TableCell>
    </TableRow>
  </TableBody>
</Table>
```

## Composition

```text
Table
├── TableCaption
├── TableHeader
│   └── TableRow
│       └── TableHead (one per column)
├── TableBody
│   └── TableRow (one per row)
│       └── TableCell (one per column)
└── TableFooter (optional)
    └── TableRow
        └── TableCell
```

## Examples

- Basic: invoices with caption, header and body (above).
- Footer: add `TableFooter` with a total row; `TableCell colSpan={3}` spans labels.
- Actions: use `DropdownMenu` for row actions.
- Data Table: combine with TanStack Table for sorting, filtering and pagination; see the official Data Table documentation.
- RTL: see https://ui.shadcn.com/docs/rtl.

## Props / installed API

The official page does not publish a separate props table. Installed components forward native HTML props and `className`: `Table` → table; `TableCaption` → caption; `TableHeader` → thead; `TableBody` → tbody; `TableFooter` → tfoot; `TableRow` → tr; `TableHead` → th; `TableCell` → td. Native `scope`, `colSpan` and accessibility attributes are available. No size or variant prop is defined.

`Table` includes a `data-slot="table-container"` overflow wrapper. When a surrounding ScrollArea owns horizontal scroll, disable the wrapper's overflow locally so the sticky criterion column uses the ScrollArea viewport, not a nested scroll container.

## Product comparison matrix

T6 uses criteria as rows and candidates as columns, not a record listing (§26 does not apply; parent decision). Use the full basic composition and a caption. Required/desirable groups are separate bodies, with a spanning group heading. The comparison matrix retains horizontal ScrollArea on mobile; the criterion column is sticky. Print expands all text and removes scrolling.
