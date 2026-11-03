import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Portal Comercial | CRM",
  description: "Portal comercial para gestão de clientes, propostas e vendas.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('crm-theme');var d=t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d)}catch(e){}})()`,
          }}
        />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
