import React, { useEffect, useState } from 'react';
import { ArrowUpIcon } from 'lucide-react';
import { Button } from './button';

function ScrollToTopButton(): React.ReactNode {
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

  return (
    <div>
      {showScrollButton && (
        <Button
          variant="custom"
          size="icon"
          className="fixed bottom-5 right-5 rounded-full bg-slate-700 text-slate-200 shadow-md hover:bg-slate-600 hover:text-slate-100"
          onClick={handleScrollToTop}
        >
          <ArrowUpIcon className="h-6 w-6" />
          <span className="sr-only">Scroll to top</span>
        </Button>
      )}
    </div>
  );
}

export default ScrollToTopButton;
