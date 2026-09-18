// shadcn/ui registry component, styled with Relay semantic tokens. See docs/COMPONENTS.md.
import * as React from "react";
import { cn } from "../../lib/utils.js";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input type={type} data-slot="input" className={cn(className)} {...props} />
  );
}

export { Input };
