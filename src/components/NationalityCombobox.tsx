import * as React from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { COUNTRIES } from "@/data/countries";

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hasError?: boolean;
}

export function NationalityCombobox({ value, onChange, placeholder = "Select country", hasError }: Props) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");

  const PINNED = ["United States of America"];

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? COUNTRIES.filter((c) => c.toLowerCase().includes(q))
      : COUNTRIES;

    if (!q) {
      // Pinned first, then the rest
      const rest = list.filter((c) => !PINNED.includes(c));
      return [...PINNED.filter((c) => list.includes(c)), ...rest];
    }
    return list;
  }, [query]);

  const handleSelect = (country: string) => {
    onChange(country === value ? "" : country);
    setOpen(false);
    setQuery("");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "w-full justify-between font-normal",
            !value && "text-muted-foreground",
            hasError && "border-destructive ring-1 ring-destructive"
          )}
        >
          <span className="truncate">{value || placeholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0 z-50 bg-popover border shadow-md"
        align="start"
        sideOffset={4}
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search country…"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList className="max-h-72 overflow-y-auto">
            {filtered.length === 0 ? (
              <CommandEmpty>No country found.</CommandEmpty>
            ) : !query.trim() ? (
              <>
                <CommandGroup heading="Suggested">
                  {PINNED.map((country) => (
                    <CommandItem key={country} value={country} onSelect={() => handleSelect(country)}>
                      <Check className={cn("mr-2 h-4 w-4 shrink-0", value === country ? "opacity-100" : "opacity-0")} />
                      {country}
                    </CommandItem>
                  ))}
                </CommandGroup>
                <CommandSeparator />
                <CommandGroup heading="All countries">
                  {filtered.filter((c) => !PINNED.includes(c)).map((country) => (
                    <CommandItem key={country} value={country} onSelect={() => handleSelect(country)}>
                      <Check className={cn("mr-2 h-4 w-4 shrink-0", value === country ? "opacity-100" : "opacity-0")} />
                      {country}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            ) : (
              <CommandGroup>
                {filtered.map((country) => (
                  <CommandItem key={country} value={country} onSelect={() => handleSelect(country)}>
                    <Check className={cn("mr-2 h-4 w-4 shrink-0", value === country ? "opacity-100" : "opacity-0")} />
                    {country}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
