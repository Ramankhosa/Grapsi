import { useEffect } from 'react';
import { useRouter } from 'next/router';

export default function ResearchAreasRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/profile/research-fit');
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-inset px-6 text-[13px] text-muted">
      Opening Research Fit…
    </div>
  );
}
