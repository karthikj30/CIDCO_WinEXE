"""Entry point for CIDCO_Setup.exe — the installer wizard."""

import sys

from cidco.installer import main

if __name__ == "__main__":
    sys.exit(main())
