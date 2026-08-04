import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import LoginForm from "@/components/login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const driver = await getSession();
  if (driver) redirect("/");

  return <LoginForm />;
}
