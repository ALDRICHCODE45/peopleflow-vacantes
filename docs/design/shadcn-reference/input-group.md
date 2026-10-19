<!-- Source: https://ui.shadcn.com/docs/components/base/input-group (fetched 2026-10-19). Official usage, composition and API for §19. -->

# input-group

Add addons, buttons, and helper content to inputs.

## [Installation#](#installation)

## [Usage#](#usage)

```
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group"
```

```
<InputGroup>
  <InputGroupInput placeholder="Search..." />
  <InputGroupAddon>
    <SearchIcon />
  </InputGroupAddon>
</InputGroup>
```

## [Composition#](#composition)

Use the following composition to build an `InputGroup`:

```
InputGroup
├── InputGroupInput or InputGroupTextarea
├── InputGroupAddon
├── InputGroupButton
└── InputGroupText
```

## [Align#](#align)

Use the `align` prop on `InputGroupAddon` to position the addon relative to the input.

For proper focus management, `InputGroupAddon` should always be placed after `InputGroupInput` or `InputGroupTextarea` in the DOM. Use the `align` prop to visually position the addon.

### [inline-start#](#inline-start)

Use `align="inline-start"` to position the addon at the start of the input. This is the default.

### [inline-end#](#inline-end)

Use `align="inline-end"` to position the addon at the end of the input.

### [block-start#](#block-start)

Use `align="block-start"` to position the addon above the input.

### [block-end#](#block-end)

Use `align="block-end"` to position the addon below the input.

## [Icon#](#icon)

## [Text#](#text)

## [Button#](#button)

## [Kbd#](#kbd)

## [Dropdown#](#dropdown)

## [Spinner#](#spinner)

## [Textarea#](#textarea)

## [Custom Input#](#custom-input)

Add the `data-slot="input-group-control"` attribute to your custom input for automatic focus state handling.

Here's an example of a custom resizable textarea from a third-party library.

## [RTL#](#rtl)

To enable RTL support in shadcn/ui, see the [RTL configuration guide](/docs/rtl).

## [API Reference#](#api-reference)

### [InputGroup#](#inputgroup)

The main component that wraps inputs and addons.

Prop

Type

Default

`className`

`string`

```
<InputGroup>
  <InputGroupInput />
  <InputGroupAddon />
</InputGroup>
```

### [InputGroupAddon#](#inputgroupaddon)

Displays icons, text, buttons, or other content alongside inputs.

For proper focus navigation, the `InputGroupAddon` component should be placed after the input. Set the `align` prop to position the addon.

Prop

Type

Default

`align`

`"inline-start" | "inline-end" | "block-start" | "block-end"`

`"inline-start"`

`className`

`string`

```
<InputGroupAddon align="inline-end">
  <SearchIcon />
</InputGroupAddon>
```

**For `<InputGroupInput />`, use the `inline-start` or `inline-end` alignment. For `<InputGroupTextarea />`, use the `block-start` or `block-end` alignment.**

The `InputGroupAddon` component can have multiple `InputGroupButton` components and icons.

```
<InputGroupAddon>
  <InputGroupButton>Button</InputGroupButton>
  <InputGroupButton>Button</InputGroupButton>
</InputGroupAddon>
```

### [InputGroupButton#](#inputgroupbutton)

Displays buttons within input groups.

Prop

Type

Default

`size`

`"xs" | "icon-xs" | "sm" | "icon-sm"`

`"xs"`

`variant`

`"default" | "destructive" | "outline" | "secondary" | "ghost" | "link"`

`"ghost"`

`className`

`string`

```
<InputGroupButton>Button</InputGroupButton>
<InputGroupButton size="icon-xs" aria-label="Copy">
  <CopyIcon />
</InputGroupButton>
```

### [InputGroupInput#](#inputgroupinput)

Replacement for `<Input />` when building input groups. This component has the input group styles pre-applied and uses the unified `data-slot="input-group-control"` for focus state handling.

Prop

Type

Default

`className`

`string`

All other props are passed through to the underlying `<Input />` component.

```
<InputGroup>
  <InputGroupInput placeholder="Enter text..." />
  <InputGroupAddon>
    <SearchIcon />
  </InputGroupAddon>
</InputGroup>
```

### [InputGroupTextarea#](#inputgrouptextarea)

Replacement for `<Textarea />` when building input groups. This component has the textarea group styles pre-applied and uses the unified `data-slot="input-group-control"` for focus state handling.

Prop

Type

Default

`className`

`string`

All other props are passed through to the underlying `<Textarea />` component.

```
<InputGroup>
  <InputGroupTextarea placeholder="Enter message..." />
  <InputGroupAddon align="block-end">
    <InputGroupButton>Send</InputGroupButton>
  </InputGroupAddon>
</InputGroup>
```