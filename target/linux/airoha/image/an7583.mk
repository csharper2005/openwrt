define Device/FitImageLzma
	KERNEL_SUFFIX := -uImage.itb
	KERNEL = kernel-bin | lzma | fit lzma $$(KDIR)/image-$$(DEVICE_DTS).dtb
	KERNEL_NAME := Image
endef

define Device/airoha_an7583-evb
  $(call Device/FitImageLzma)
  DEVICE_VENDOR := Airoha
  DEVICE_MODEL := AN7583 Evaluation Board (SNAND)
  DEVICE_PACKAGES := kmod-phy-aeonsemi-as21xxx kmod-leds-pwm kmod-pwm-airoha kmod-input-gpio-keys-polled
  DEVICE_DTS := an7583-evb
  DEVICE_DTS_CONFIG := config@1
  KERNEL_LOADADDR := 0x80088000
  IMAGE/sysupgrade.bin := append-kernel | pad-to 128k | append-rootfs | pad-rootfs | append-metadata
endef
TARGET_DEVICES += airoha_an7583-evb

define Device/nokia_xg-040g-mf
  $(call Device/FitImageLzma)
  DEVICE_VENDOR := Nokia
  DEVICE_MODEL := XG-040G-MF
  DEVICE_PACKAGES := airoha-an7583-npu-firmware kmod-phy-airoha-en8811h \
	kmod-regulator-userspace-consumer kmod-usb-ledtrig-usbport \
	kmod-usb3 ubootenv-tools
  DEVICE_DTS := an7583-nokia_xg-040g-mf
  DEVICE_DTS_CONFIG := config@1
  KERNEL_LOADADDR := 0x80200000
  IMAGE/sysupgrade.bin := sysupgrade-tar | append-metadata
  SOC := an7583
endef
TARGET_DEVICES += nokia_xg-040g-mf

define Device/airoha_an7583-evb-emmc
  DEVICE_VENDOR := Airoha
  DEVICE_MODEL := AN7583 Evaluation Board (EMMC)
  DEVICE_DTS := an7583-evb-emmc
  DEVICE_PACKAGES := kmod-phy-airoha-en8811h kmod-i2c-an7581
endef
TARGET_DEVICES += airoha_an7583-evb-emmc
