cp target/linux/qualcommax/files/arch/arm64/boot/dts/qcom/ipq5018-mi-router-ax3000t-v2.dts build_dir/target-aarch64_cortex-a53_musl/linux-qualcommax_ipq50xx/linux-6.12.63/arch/arm64/boot/dts/qcom/ipq5018-mi-router-ax3000t-v2.dts
make V=s -j$(nproc) 2>&1 | tee log
