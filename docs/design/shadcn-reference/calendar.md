<!-- Source: https://ui.shadcn.com/docs/components/base/calendar and registry https://ui.shadcn.com/r/styles/base-rhea/calendar-example.json (fetched 2026-11-02). Official usage, composition and API. -->

# Calendar

A calendar component that allows users to select a date or a range of dates. Built on
[React DayPicker](https://react-day-picker.js.org). Already installed at
`frontend/src/components/ui/calendar.tsx` (style `base-rhea`); the project's date field wrapper is
`frontend/src/components/ui/date-picker-field.tsx`.

## Installation

```sh
pnpm dlx shadcn@latest add calendar
```

## Usage

```tsx
import { Calendar } from "@/components/ui/calendar"
```

```tsx
const [date, setDate] = React.useState<Date | undefined>(new Date())

return (
  <Calendar
    mode="single"
    selected={date}
    onSelect={setDate}
    className="rounded-lg border"
  />
)
```

## Date Picker

Use `<Calendar>` inside a `Popover` to build a date picker (official `DatePickerSimple` in
`examples/calendar-example.tsx.txt`):

```tsx
<Field>
  <FieldLabel htmlFor="date-picker-simple">Date</FieldLabel>
  <Popover>
    <PopoverTrigger
      render={
        <Button
          variant="outline"
          id="date-picker-simple"
          className="justify-start px-2.5 font-normal"
        />
      }
    >
      <CalendarIcon data-icon="inline-start" />
      {date ? format(date, "PPP") : <span>Pick a date</span>}
    </PopoverTrigger>
    <PopoverContent className="w-auto p-0" align="start">
      <Calendar mode="single" selected={date} onSelect={setDate} />
    </PopoverContent>
  </Popover>
</Field>
```

## Variants

- **Range:** `mode="range"` (optionally `numberOfMonths={2}`).
- **Month and year selector:** `captionLayout="dropdown"`.
- **Booked / disabled dates:** `disabled={...}` matchers (see `CalendarBookedDates`).
- **Presets, date and time, week numbers (`showWeekNumber`):** see the official examples file.

## Selected date (with time zone)

`Calendar` accepts a `timeZone` prop. If a selected date appears offset (selecting the 20th
highlights the 19th), set `timeZone` to the user's local zone, detected client-side:

```tsx
React.useEffect(() => {
  setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone)
}, [])
```

## Custom cell size

```tsx
<Calendar className="rounded-lg border [--cell-size:--spacing(11)] md:[--cell-size:--spacing(12)]" />
```

## Locale

Import the locale from `react-day-picker/locale` and pass it as `locale` (for this product,
`es`):

```tsx
import { es } from "react-day-picker/locale"

<Calendar mode="single" selected={date} onSelect={setDate} locale={es} />
```

## API Reference

See the [React DayPicker](https://react-day-picker.js.org) documentation.
