import Link from "next/link";
import { Wordmark } from "@/components/layout/Wordmark";
import { Suspense } from "react";

import { ResetPasswordForm } from "@/components/common/reset-password-form";

export default function ResetPasswordPage() {
  return (
    <main className="min-h-screen bg-canvas-pink px-6 py-8 text-charcoal">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-md flex-col justify-center">
        <Link href="/" className="mb-8 inline-flex w-fit items-center transition-transform duration-200 hover:-translate-y-[1px]">
          <Wordmark className="text-charcoal text-[20px]" />
        </Link>

        <section className="rounded-[18px] border-2 border-charcoal bg-surface-white p-6 shadow-[8px_8px_0_#000]">
          <div className="mb-6 space-y-2">
            <h1 className="font-alfa text-3xl">设置新密码</h1>
            <p className="text-sm font-bold text-charcoal/70">
              输入新密码后即可回到登录页。
            </p>
          </div>

          <Suspense fallback={<div className="text-sm font-bold">Loading...</div>}>
            <ResetPasswordForm />
          </Suspense>
        </section>
      </div>
    </main>
  );
}
