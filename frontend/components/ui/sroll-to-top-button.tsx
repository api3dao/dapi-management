import { useEffect, useState } from 'react';
import { ArrowUpIcon } from 'lucide-react';
import { Button } from './button';

export default function ScrollToTopButton() {
  const [showScrollButton, setShowScrollButton] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setShowScrollButton(window.scrollY > 300);
    };

    window.addEventListener('scroll', handleScroll);

    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  const handleScrollToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    });
  };

  if (!showScrollButton) {
    return null;
  }

  return (
    <Button
      variant="custom"
      size="icon"
      className="fixed bottom-5 right-5 rounded-full bg-slate-700 text-slate-200 shadow-md hover:bg-slate-600 hover:text-slate-100"
      onClick={handleScrollToTop}
    >
      <ArrowUpIcon className="h-6 w-6" />
      <span className="sr-only">Scroll to top</span>
    </Button>
  );
}
