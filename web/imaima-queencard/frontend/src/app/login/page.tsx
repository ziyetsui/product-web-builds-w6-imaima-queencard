import Link from "next/link";
import { Wordmark } from "@/components/layout/Wordmark";
import { Suspense } from "react";

import { UserAuthForm } from "@/components/common/user-auth-form";

export default function LoginPage() {
  return (
    <main className="min-h-screen bg-canvas-pink px-6 py-8 text-charcoal">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-md flex-col justify-center">
        <Link href="/" className="mb-8 inline-flex w-fit items-center transition-transform duration-200 hover:-translate-y-[1px]">
          <Wordmark className="text-charcoal text-[20px]" />
        </Link>

        <section className="rounded-[18px] border-2 border-charcoal bg-surface-white p-6 shadow-[8px_8px_0_#000]">
          <div className="mb-6 space-y-2">
            <h1 className="font-alfa text-3xl">邮箱登录</h1>
            <p className="text-sm font-bold text-charcoal/70">
              使用邮箱和密码访问你的工作区。
            </p>
          </div>

          <Suspense fallback={<div className="text-sm font-bold">加载中...</div>}>
            <UserAuthForm mode="login" />
          </Suspense>

          <p className="mt-6 text-center text-sm font-bold text-charcoal/70">
            还没有账号？{" "}
            <Link href="/register" className="underline decoration-2 underline-offset-4">
              创建账号
            </Link>
          </p>
        </section>
      </div>
    </main>
  );
}
