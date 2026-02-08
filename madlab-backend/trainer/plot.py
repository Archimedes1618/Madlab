import numpy as np
import matplotlib.pyplot as plt
import sys

# Define accuracy range
accuracy = np.linspace(0.0, 1.0, 200)

# Define Gaussian penalty function
def gaussian_penalty(x, mu, sigma):
    return np.exp(-((x - mu) ** 2) / (2 * sigma ** 2))

# Parameters for high-performing and lower-performing models
mu_high, sigma_high = 0.25, 0.10
mu_low, sigma_low = 0.40, 0.20

# Compute penalty factors
penalty_high = gaussian_penalty(accuracy, mu_high, sigma_high)
penalty_low = gaussian_penalty(accuracy, mu_low, sigma_low)

# Create plot with enhanced styling
plt.style.use('seaborn-v0_8')
fig, ax = plt.subplots(figsize=(12, 8))

# Plot Gaussian curves with enhanced visual appeal
ax.plot(accuracy, penalty_high, 
        label='High-performing (μ=0.25, σ=0.10)', 
        color='#FF6B6B', 
        linewidth=3, 
        alpha=0.9,
        linestyle='-',
        marker='o', 
        markersize=4,
        markevery=10)

ax.plot(accuracy, penalty_low, 
        label='Lower-performing (μ=0.40, σ=0.20)', 
        color='#4ECDC4', 
        linewidth=3, 
        alpha=0.9,
        linestyle='--',
        marker='s', 
        markersize=4,
        markevery=10)

# Shade sweet zones with gradient effects
x_fill_high = np.linspace(mu_high - 0.05, mu_high + 0.05, 100)
y_fill_high = gaussian_penalty(x_fill_high, mu_high, sigma_high)
ax.fill_between(x_fill_high, y_fill_high, alpha=0.3, color='#FF6B6B', label='Sweet Zone (High-performing)')

x_fill_low = np.linspace(mu_low - 0.07, mu_low + 0.07, 100)
y_fill_low = gaussian_penalty(x_fill_low, mu_low, sigma_low)
ax.fill_between(x_fill_low, y_fill_low, alpha=0.3, color='#4ECDC4', label='Sweet Zone (Lower-performing)')

# Add vertical lines at mean values
ax.axvline(mu_high, color='#FF6B6B', linestyle=':', linewidth=2, alpha=0.7)
ax.axvline(mu_low, color='#4ECDC4', linestyle=':', linewidth=2, alpha=0.7)

# Customize the plot with enhanced styling
ax.set_xlabel('Accuracy', fontsize=14, fontweight='bold')
ax.set_ylabel('Gaussian Weight', fontsize=14, fontweight='bold')
ax.set_title('Model Performance Analysis', fontsize=18, fontweight='bold', pad=20)

# Add grid with custom styling
ax.grid(True, alpha=0.3, linestyle='-', linewidth=0.5)
ax.set_axisbelow(True)

# Customize legend with enhanced appearance
legend = ax.legend(loc='upper right', frameon=True, fancybox=True, shadow=True, 
                   framealpha=0.9, fontsize=11, ncol=1)
legend.get_frame().set_facecolor('white')
legend.get_frame().set_edgecolor('lightgray')
legend.get_frame().set_linewidth(1.5)

# Set background color and spines
ax.set_facecolor('#F8F9FA')
for spine in ax.spines.values():
    spine.set_linewidth(2)
    spine.set_color('lightgray')

# Set axis limits for better visualization
ax.set_xlim(0.0, 1.0)
ax.set_ylim(0.0, 1.2)

# Add subtle background pattern effect
ax.axhline(y=0.5, color='gray', linestyle='-', alpha=0.1, linewidth=1)
ax.axhline(y=0.8, color='gray', linestyle='-', alpha=0.1, linewidth=1)

# Enhance tick labels
ax.tick_params(axis='both', which='major', labelsize=12)

# Add model marker (dynamic part)
def plot_model_position(accuracy_value, judge_score, normalized_rdi):
    # Determine which curve to use based on score
    mu = 0.25 if judge_score >= 8.0 else 0.40
    sigma = 0.10 if judge_score >= 8.0 else 0.20

    penalty = gaussian_penalty(accuracy_value, mu, sigma)
    
    # Plot marker for model
    ax.scatter([accuracy_value], [penalty], s=300, c='gold', edgecolors='black', linewidth=2, zorder=5, marker='*', label=f'Model (RDI: {normalized_rdi:.1f})')

# Parse command line arguments
if len(sys.argv) != 4:
    print("Usage: python plot.py <accuracy> <judge_score> <normalized_rdi>")
    sys.exit(1)

try:
    accuracy_value = float(sys.argv[1])
    judge_score = float(sys.argv[2])
    normalized_rdi = float(sys.argv[3])
    
    # Validate ranges
    if not (0 <= accuracy_value <= 1):
        raise ValueError("Accuracy must be between 0 and 1")
    if not (0 <= normalized_rdi <= 100):
        raise ValueError("Normalized RDI must be between 0 and 100")
        
    plot_model_position(accuracy_value, judge_score, normalized_rdi)
   
except ValueError as e:
    print(f"Error: {e}")
    sys.exit(1)

# Adjust layout to prevent clipping
plt.tight_layout()

# Save the plot (optional)
# output_path = "model_performance_plot.png"
# plt.savefig(output_path, dpi=300, bbox_inches='tight')
# print(f"Plot saved to {output_path}")

# Display the plot
plt.show()
