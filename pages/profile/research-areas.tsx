import { useEffect } from 'react';
import { useRouter } from 'next/router';

export default function ResearchAreasRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/profile/research-fit');
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6 text-sm text-slate-600">
      Opening Research Fit...
    </div>
  );
}
