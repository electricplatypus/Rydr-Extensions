import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        void: "#0b0d12",
        panel: "#12151c",
        border: "#232733",
        accent: "#ff6a00",
        muted: "#7d8ba0",
      },
    },
  },
  plugins: [],
};

export default config;
