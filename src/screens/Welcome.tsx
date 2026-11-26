// First run: nothing to watch until a playlist is added.
import { OrbitMark } from '../ui/icons';
import { SourceForm } from './SourceForm';

export function Welcome() {
  return (
    <div class="screen opaque">
      <div class="welcome">
        <div>
          <OrbitMark class="welcome-orbit" />
          <h1>Add your TV provider</h1>
          <p class="lead">Orbit plays the channels, films and series from your own IPTV subscription. Enter the details your provider sent you to get started.</p>
        </div>
        <div class="panel"><SourceForm /></div>
      </div>
    </div>
  );
}
