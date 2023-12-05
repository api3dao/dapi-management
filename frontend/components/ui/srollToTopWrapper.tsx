import React, { useEffect, useState } from 'react';
import { ChevronUp } from 'lucide-react';

interface ScrollToTopWrapperProps {
  children: React.ReactNode;
}

const ScrollToTopWrapper: React.FC<ScrollToTopWrapperProps> = ({ children }) => {
  const [showScrollButton, setShowScrollButton] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      // Show the button when the user has scrolled down 100 pixels or more
      setShowScrollButton(window.scrollY > 100);
    };

    // Add scroll event listener
    window.addEventListener('scroll', handleScroll);

    // Remove event listener on component unmount
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
    <div className="relative">
      {children}
      {showScrollButton && (
        <ChevronUp
          className="fixed bottom-5 right-5 h-11 w-11 cursor-pointer rounded-full bg-blue-500 text-white"
          onClick={handleScrollToTop}
        />
      )}
    </div>
  );
};

export default ScrollToTopWrapper;
