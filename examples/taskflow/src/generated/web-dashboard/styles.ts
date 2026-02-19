export interface StyleConfig {
  breakpoints: {
    mobile: string;
    desktop: string;
  };
  colors: {
    primary: string;
    secondary: string;
    background: string;
    surface: string;
    text: string;
    textSecondary: string;
    border: string;
    shadow: string;
  };
  typography: {
    fontFamily: string;
    sizes: {
      h1: string;
      body: string;
    };
  };
  spacing: {
    xs: string;
    sm: string;
    md: string;
    lg: string;
    xl: string;
  };
  borderRadius: {
    card: string;
    button: string;
  };
}

export interface ComponentStyles {
  layout: string;
  card: string;
  button: string;
  typography: string;
}

const defaultConfig: StyleConfig = {
  breakpoints: {
    mobile: '768px',
    desktop: '769px'
  },
  colors: {
    primary: '#007bff',
    secondary: '#6c757d',
    background: '#ffffff',
    surface: '#f8f9fa',
    text: '#212529',
    textSecondary: '#6c757d',
    border: '#dee2e6',
    shadow: 'rgba(0, 0, 0, 0.1)'
  },
  typography: {
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    sizes: {
      h1: '1.5rem',
      body: '0.95rem'
    }
  },
  spacing: {
    xs: '0.25rem',
    sm: '0.5rem',
    md: '1rem',
    lg: '1.5rem',
    xl: '2rem'
  },
  borderRadius: {
    card: '8px',
    button: '4px'
  }
};

export function generateStyles(config: Partial<StyleConfig> = {}): ComponentStyles {
  const mergedConfig: StyleConfig = {
    ...defaultConfig,
    ...config,
    colors: { ...defaultConfig.colors, ...config.colors },
    typography: { ...defaultConfig.typography, ...config.typography },
    spacing: { ...defaultConfig.spacing, ...config.spacing },
    borderRadius: { ...defaultConfig.borderRadius, ...config.borderRadius }
  };

  const layout = `
    .phoenix-layout {
      display: grid;
      grid-template-columns: 1fr;
      gap: ${mergedConfig.spacing.md};
      padding: ${mergedConfig.spacing.md};
      max-width: 100%;
      margin: 0 auto;
    }

    @media (min-width: ${mergedConfig.breakpoints.desktop}) {
      .phoenix-layout {
        grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
        gap: ${mergedConfig.spacing.lg};
        padding: ${mergedConfig.spacing.xl};
        max-width: 1200px;
      }
    }
  `;

  const card = `
    .phoenix-card {
      background: ${mergedConfig.colors.surface};
      border: 1px solid ${mergedConfig.colors.border};
      border-radius: ${mergedConfig.borderRadius.card};
      padding: ${mergedConfig.spacing.lg};
      box-shadow: 0 2px 4px ${mergedConfig.colors.shadow};
      transition: box-shadow 0.2s ease, transform 0.2s ease;
    }

    .phoenix-card:hover {
      box-shadow: 0 4px 8px ${mergedConfig.colors.shadow};
      transform: translateY(-1px);
    }
  `;

  const button = `
    .phoenix-button {
      background: ${mergedConfig.colors.primary};
      color: ${mergedConfig.colors.background};
      border: none;
      border-radius: ${mergedConfig.borderRadius.button};
      padding: ${mergedConfig.spacing.sm} ${mergedConfig.spacing.md};
      font-family: ${mergedConfig.typography.fontFamily};
      font-size: ${mergedConfig.typography.sizes.body};
      cursor: pointer;
      transition: background-color 0.2s ease, transform 0.1s ease;
      display: inline-block;
      text-decoration: none;
      text-align: center;
    }

    .phoenix-button:hover {
      background: ${adjustColor(mergedConfig.colors.primary, -10)};
      transform: translateY(-1px);
    }

    .phoenix-button:active {
      transform: translateY(0);
    }

    .phoenix-button--secondary {
      background: ${mergedConfig.colors.secondary};
    }

    .phoenix-button--secondary:hover {
      background: ${adjustColor(mergedConfig.colors.secondary, -10)};
    }
  `;

  const typography = `
    .phoenix-typography {
      font-family: ${mergedConfig.typography.fontFamily};
      color: ${mergedConfig.colors.text};
      line-height: 1.5;
    }

    .phoenix-typography h1 {
      font-size: ${mergedConfig.typography.sizes.h1};
      font-weight: 600;
      margin: 0 0 ${mergedConfig.spacing.md} 0;
      color: ${mergedConfig.colors.text};
    }

    .phoenix-typography p,
    .phoenix-typography div,
    .phoenix-typography span {
      font-size: ${mergedConfig.typography.sizes.body};
      margin: 0 0 ${mergedConfig.spacing.sm} 0;
    }

    .phoenix-typography--secondary {
      color: ${mergedConfig.colors.textSecondary};
    }
  `;

  return {
    layout,
    card,
    button,
    typography
  };
}

export function injectStyles(styles: ComponentStyles): void {
  const styleElement = createStyleElement();
  const combinedStyles = Object.values(styles).join('\n');
  styleElement.textContent = combinedStyles;
}

export function createStyleElement(): HTMLStyleElement {
  if (typeof document === 'undefined') {
    throw new Error('createStyleElement can only be used in browser environment');
  }
  
  const existingStyle = document.getElementById('phoenix-styles');
  if (existingStyle) {
    return existingStyle as HTMLStyleElement;
  }

  const style = document.createElement('style');
  style.id = 'phoenix-styles';
  style.type = 'text/css';
  document.head.appendChild(style);
  return style;
}

export function generateCSSString(config?: Partial<StyleConfig>): string {
  const styles = generateStyles(config);
  return Object.values(styles).join('\n');
}

function adjustColor(color: string, percent: number): string {
  if (!color.startsWith('#')) {
    return color;
  }
  
  const num = parseInt(color.slice(1), 16);
  const amt = Math.round(2.55 * percent);
  const R = (num >> 16) + amt;
  const G = (num >> 8 & 0x00FF) + amt;
  const B = (num & 0x0000FF) + amt;
  
  return '#' + (0x1000000 + (R < 255 ? R < 1 ? 0 : R : 255) * 0x10000 +
    (G < 255 ? G < 1 ? 0 : G : 255) * 0x100 +
    (B < 255 ? B < 1 ? 0 : B : 255))
    .toString(16)
    .slice(1);
}

export const defaultStyleConfig = defaultConfig;

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: 'fd1e1e3084a491150550d575098a4a929a5be62ccb0b000a173679da38aed9fa',
  name: 'Styles',
  risk_tier: 'medium',
  canon_ids: [4 as const],
} as const;