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
  spacing: {
    xs: string;
    sm: string;
    md: string;
    lg: string;
    xl: string;
  };
  typography: {
    fontFamily: string;
    h1Size: string;
    bodySize: string;
  };
  effects: {
    borderRadius: string;
    cardShadow: string;
    cardShadowHover: string;
    transition: string;
  };
}

export const defaultStyleConfig: StyleConfig = {
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
  spacing: {
    xs: '0.25rem',
    sm: '0.5rem',
    md: '1rem',
    lg: '1.5rem',
    xl: '2rem'
  },
  typography: {
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    h1Size: '1.5rem',
    bodySize: '0.95rem'
  },
  effects: {
    borderRadius: '8px',
    cardShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
    cardShadowHover: '0 4px 8px rgba(0, 0, 0, 0.15)',
    transition: 'all 0.2s ease-in-out'
  }
};

export class StyleManager {
  private config: StyleConfig;
  private styleElement: string | null = null;

  constructor(config: StyleConfig = defaultStyleConfig) {
    this.config = config;
  }

  generateCSS(): string {
    const { breakpoints, colors, spacing, typography, effects } = this.config;

    return `
      /* Reset and base styles */
      * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
      }

      body {
        font-family: ${typography.fontFamily};
        font-size: ${typography.bodySize};
        line-height: 1.6;
        color: ${colors.text};
        background-color: ${colors.background};
      }

      /* Typography */
      h1 {
        font-size: ${typography.h1Size};
        font-weight: 600;
        color: ${colors.text};
        margin-bottom: ${spacing.lg};
      }

      /* Layout - Mobile First */
      .container {
        width: 100%;
        max-width: 1200px;
        margin: 0 auto;
        padding: ${spacing.md};
      }

      .grid {
        display: grid;
        grid-template-columns: 1fr;
        gap: ${spacing.lg};
      }

      /* Desktop Layout */
      @media (min-width: ${breakpoints.desktop}) {
        .grid {
          grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
        }

        .grid-2 {
          grid-template-columns: repeat(2, 1fr);
        }

        .grid-3 {
          grid-template-columns: repeat(3, 1fr);
        }

        .grid-4 {
          grid-template-columns: repeat(4, 1fr);
        }
      }

      /* Cards */
      .card {
        background: ${colors.surface};
        border: 1px solid ${colors.border};
        border-radius: ${effects.borderRadius};
        padding: ${spacing.lg};
        box-shadow: ${effects.cardShadow};
        transition: ${effects.transition};
      }

      .card:hover {
        box-shadow: ${effects.cardShadowHover};
        transform: translateY(-2px);
      }

      /* Buttons */
      .btn {
        display: inline-block;
        padding: ${spacing.sm} ${spacing.lg};
        border: none;
        border-radius: ${effects.borderRadius};
        font-family: ${typography.fontFamily};
        font-size: ${typography.bodySize};
        font-weight: 500;
        text-decoration: none;
        text-align: center;
        cursor: pointer;
        transition: ${effects.transition};
        background-color: ${colors.primary};
        color: white;
      }

      .btn:hover {
        opacity: 0.9;
        transform: translateY(-1px);
      }

      .btn:active {
        transform: translateY(0);
      }

      .btn-secondary {
        background-color: ${colors.secondary};
      }

      .btn-outline {
        background-color: transparent;
        color: ${colors.primary};
        border: 1px solid ${colors.primary};
      }

      .btn-outline:hover {
        background-color: ${colors.primary};
        color: white;
      }

      /* Utility classes */
      .text-center {
        text-align: center;
      }

      .text-secondary {
        color: ${colors.textSecondary};
      }

      .mb-sm { margin-bottom: ${spacing.sm}; }
      .mb-md { margin-bottom: ${spacing.md}; }
      .mb-lg { margin-bottom: ${spacing.lg}; }
      .mb-xl { margin-bottom: ${spacing.xl}; }

      .mt-sm { margin-top: ${spacing.sm}; }
      .mt-md { margin-top: ${spacing.md}; }
      .mt-lg { margin-top: ${spacing.lg}; }
      .mt-xl { margin-top: ${spacing.xl}; }

      .p-sm { padding: ${spacing.sm}; }
      .p-md { padding: ${spacing.md}; }
      .p-lg { padding: ${spacing.lg}; }
      .p-xl { padding: ${spacing.xl}; }

      /* Responsive utilities */
      @media (max-width: ${breakpoints.mobile}) {
        .hide-mobile {
          display: none;
        }
      }

      @media (min-width: ${breakpoints.desktop}) {
        .hide-desktop {
          display: none;
        }
      }
    `;
  }

  getStyleElement(): string {
    if (!this.styleElement) {
      this.styleElement = `<style>${this.generateCSS()}</style>`;
    }
    return this.styleElement;
  }

  updateConfig(newConfig: Partial<StyleConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.styleElement = null; // Reset cached styles
  }

  getConfig(): StyleConfig {
    return { ...this.config };
  }

  generateInlineStyles(element: string, styles: Record<string, string>): string {
    const styleString = Object.entries(styles)
      .map(([property, value]) => `${property}: ${value}`)
      .join('; ');
    
    return `${element} { ${styleString} }`;
  }

  createResponsiveGrid(columns: { mobile: number; desktop: number }): string {
    return `
      display: grid;
      grid-template-columns: repeat(${columns.mobile}, 1fr);
      gap: ${this.config.spacing.lg};

      @media (min-width: ${this.config.breakpoints.desktop}) {
        grid-template-columns: repeat(${columns.desktop}, 1fr);
      }
    `;
  }

  createCard(content: string, className: string = ''): string {
    return `<div class="card ${className}">${content}</div>`;
  }

  createButton(text: string, type: 'primary' | 'secondary' | 'outline' = 'primary', onClick?: string): string {
    const buttonClass = type === 'primary' ? 'btn' : `btn btn-${type}`;
    const onClickAttr = onClick ? ` onclick="${onClick}"` : '';
    return `<button class="${buttonClass}"${onClickAttr}>${text}</button>`;
  }
}

export function createStyleManager(config?: Partial<StyleConfig>): StyleManager {
  const finalConfig = config ? { ...defaultStyleConfig, ...config } : defaultStyleConfig;
  return new StyleManager(finalConfig);
}

export function generateResponsiveHTML(content: string, title?: string): string {
  const styleManager = createStyleManager();
  
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      ${title ? `<title>${title}</title>` : ''}
      ${styleManager.getStyleElement()}
    </head>
    <body>
      <div class="container">
        ${content}
      </div>
    </body>
    </html>
  `;
}

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: '8d072032308810bce8136ef5a0a51f8e99a35d83edfa38f4d69cdca300d1c6af',
  name: 'Styles',
  risk_tier: 'medium',
  canon_ids: [4 as const],
} as const;