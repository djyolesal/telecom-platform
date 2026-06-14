export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#1B3F6B] to-[#0E7C6B] p-4">
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}
