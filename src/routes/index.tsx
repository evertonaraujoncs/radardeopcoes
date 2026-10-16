import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [
    { title: "Radar de Opções B3 — Monitor de estruturas" },
    { name: "description", content: "Acompanhe sinais, estruturas e dados recebidos do mercado de opções da B3." },
    { property: "og:title", content: "Radar de Opções B3 — Monitor de estruturas" },
    { property: "og:description", content: "Acompanhe sinais, estruturas e dados recebidos do mercado de opções da B3." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  beforeLoad: () => {
    throw redirect({ to: "/radar" });
  },
});
