import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(input: string | number | Date): string {
  const date = new Date(input)

  return date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })
}

export function absoluteUrl(path: string) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:8080"
  return `${appUrl}${path}`
}
