// shadcn/ui registry component, styled with Relay semantic tokens. See docs/COMPONENTS.md.
import * as React from "react";
import { cn } from "../../lib/utils.js";
import { ChevronDownIcon } from "lucide-react";

function NativeSelect({
  className,
  ...props
}: React.ComponentProps<"select">) {
  return (
    <div data-slot="native-select-wrapper">
      <select
        data-slot="native-select"
        className={cn(className)}
        {...props}
      />
      <ChevronDownIcon

        aria-hidden="true"
        data-slot="native-select-icon"
      />
    </div>
  );
}

function NativeSelectOption({
  className,
  ...props
}: React.ComponentProps<"option">) {
  return (
    <option
      data-slot="native-select-option"
      className={cn(className)}
      {...props}
    />
  );
}

export { NativeSelect, NativeSelectOption };
