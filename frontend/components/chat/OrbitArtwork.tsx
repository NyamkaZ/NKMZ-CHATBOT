import Image from "next/image";
import copperOrbit from "./artwork/copper-orbit.webp";
import styles from "./OrbitArtwork.module.css";

/** Image fallback for devices that cannot render the dashboard's WebGL scene. */
export function OrbitArtwork() {
  return (
    <div aria-hidden="true" className={styles.scene}>
      <Image
        alt=""
        src={copperOrbit}
        className={styles.disc}
        draggable={false}
        unoptimized
      />
    </div>
  );
}
