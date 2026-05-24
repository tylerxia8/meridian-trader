import "./globals.css";
import { MeridianWalletProvider } from "@/components/WalletProvider";
import { NavBar } from "@/components/NavBar";

export const metadata = {
  title: "Meridian",
  description: "Binary stock outcome markets on Solana",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <MeridianWalletProvider>
          <NavBar />
          <main className="mx-auto max-w-6xl px-6 py-10">{children}</main>
        </MeridianWalletProvider>
      </body>
    </html>
  );
}
