import logo from '../assets/images/iconUrbe.png';

export default function Brand({ light = false }) {
  return (
    <a className={`brand${light ? ' brand-light' : ''}`} href="/" aria-label="AppUrbe inicio">
      <img className="brand-logo" src={logo} alt="" />
      <span className="brand-name">App<span className="brand-strong">Urbe</span></span>
    </a>
  );
}
