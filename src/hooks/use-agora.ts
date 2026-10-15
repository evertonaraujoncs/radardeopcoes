import { useEffect, useState } from "react";

export function useAgora(intervalo = 30000) {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setAgora(Date.now()), intervalo);
    return () => clearInterval(id);
  }, [intervalo]);
  return agora;
}
