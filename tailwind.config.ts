import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        cream: "#101010",
        oat: "#292929",
        ink: "#f7f7f2",
        sage: "#ff6fb1",
        peach: "#ff8a65",
        skysoft: "#22312b",
        butter: "#ffe1ef",
        coral: "#ff6b6b",
      },
      boxShadow: {
        soft: "0 18px 45px rgba(0, 0, 0, 0.28)",
      },
    },
  },
  plugins: [],
};

export default config;
