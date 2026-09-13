// shadcn/ui registry component, styled with Relay semantic tokens. See docs/COMPONENTS.md.
"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Label as LabelPrimitive } from "radix-ui";

function Label({
  className,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(className)}
      {...props}
    />
  );
}

export { Label };
