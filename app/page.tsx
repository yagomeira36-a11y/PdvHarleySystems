// Página inicial: redireciona para o PDV
import { redirect } from "next/navigation";

export default function Home() {
  redirect("/pdv");
}
