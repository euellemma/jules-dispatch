/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: "#2e2b30",
        "primary-hover": "#3d3a41",
        "accent-bg": "#f9f8ff",
      },
    },
  },
  plugins: [],
}

