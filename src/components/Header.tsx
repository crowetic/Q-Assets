import { Link } from 'react-router-dom';
import { useTheme } from '@mui/material/styles';

const Header = () => {
  const theme = useTheme();

  return (
    <header
      className="flex flex-col items-center justify-center py-6 px-4 border-b"
      style={{ backgroundColor: theme.palette.primary.main }}
    >
      {/* Logo section */}
      <div className="flex flex-col items-center">
        <img
          src="/src/assets/Q-Assets-Logo.png"
          alt="Q-Assets Logo"
          className="h-80 w-80 object-contain"
        />
        {/* <h1 className="text-xl font-bold tracking-wide">Q-Assets</h1> */}
      </div>

      {/* Navigation section */}
      <nav className="flex flex-wrap justify-center md:justify-end gap-3 text-lg ">
        <Link to="/" className="hover:underline">
          Home
        </Link>
        <Link to="/assets" className="hover:underline">
          Assets
        </Link>
        <Link to="/issue" className="hover:underline">
          Issue
        </Link>
        <Link to="/portfolio" className="hover:underline">
          Portfolio
        </Link>
        <Link to="/trade" className="hover:underline">
          Trade
        </Link>
      </nav>
    </header>
  );
};

export default Header;
