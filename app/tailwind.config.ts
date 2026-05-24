import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        yes: "#10b981",
        no: "#ef4444",
        ink: "#0a0f1c",
        panel: "#11192c",
      },
    },
  },
  plugins: [],
};
export default config;
