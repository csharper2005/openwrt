DEVICE_VARS += SERCOMM_KERNEL_OFFSET SERCOMM_ROOTFS_OFFSET
DEVICE_VARS += SERCOMM_KERNEL2_OFFSET SERCOMM_ROOTFS2_OFFSET
DEVICE_VARS += SERCOMM_0x10str

define Build/sercomm-crypto
	$(TOPDIR)/scripts/sercomm-crypto.py \
		--input-file $@ \
		--key-file $@.key \
		--output-file $@.ser \
		--version $(SERCOMM_SWVER)
	$(STAGING_DIR_HOST)/bin/openssl enc -md md5 -aes-256-cbc \
		-in $@ \
		-out $@.enc \
		-K `cat $@.key` \
		-iv 00000000000000000000000000000000
	dd if=$@.enc >> $@.ser 2>/dev/null
	mv $@.ser $@
	rm -f $@.enc $@.key
endef

define Build/sercomm-factory-awi
	$(call Build/sercomm-kernel-trim,$(IMAGE_KERNEL) \
		$(IMAGE_KERNEL).data)
	$(call Build/sercomm-pid,$@.hdrfactory)
	$(call Build/sercomm-write-pid,$(IMAGE_KERNEL).data $$((0x70)) \
		$@.hdrfactory)
	$(call Build/sercomm-write-pid,$@ $$((0x80)) $@.hdrfactory)
	$(call Build/sercomm-footer,$@.footer)
	$(call Build/sercomm-write-pid,$@.footer $$((0x90)) $@.hdrfactory)
	cat $(IMAGE_KERNEL).data $@ $@.footer | $(MKHASH) md5 | \
		awk '{print $$1}' | tr -d '\n' | dd seek=$$((0x1e0)) \
		of=$@.hdrfactory bs=1 conv=notrunc 2>/dev/null
	$(call Build/sercomm-kernel-factory,$(IMAGE_KERNEL).data \
		$@ $@.hdrkrnl)
	cat $@.hdrfactory $@.hdrkrnl $(IMAGE_KERNEL).data \
		$@ $@.footer > $@.new
	mv $@.new $@
	rm -f $@.hdrfactory $@.hdrkrnl $(IMAGE_KERNEL).data
endef

define Build/sercomm-factory-cqr
	$(call Build/sercomm-kernel-trim,$(IMAGE_KERNEL) \
		$(IMAGE_KERNEL).data)
	$(call Build/sercomm-pid,$@.hdrfactory)
	$(call Build/sercomm-write-pid,$(IMAGE_KERNEL).data $$((0x70)) \
		$@.hdrfactory)
	$(call Build/sercomm-write-pid,$@ $$((0x80)) $@.hdrfactory)
	cat $(IMAGE_KERNEL).data $@ | $(MKHASH) md5 | \
		awk '{print $$1}' | tr -d '\n' | \
		dd seek=$$((0x1e0)) of=$@.hdrfactory bs=1 \
		conv=notrunc 2>/dev/null
	$(call Build/sercomm-kernel-factory,$(IMAGE_KERNEL).data \
		$@ $@.hdrkrnl)
	cat $@.hdrfactory $@.hdrkrnl $(IMAGE_KERNEL).data $@ > $@.new
	mv $@.new $@
	rm -f $@.hdrfactory $@.hdrkrnl $(IMAGE_KERNEL).data
endef

define Build/sercomm-footer
	printf 11223344556677889900112233445566 | sed 's/../\\x&/g' | \
		xargs -d . printf | \
		dd of=$(word 1,$(1)) conv=notrunc 2>/dev/null
endef

define Build/sercomm-kernel
	$(TOPDIR)/scripts/sercomm-kernel-header.py \
		--kernel-image $@ \
		--kernel-offset $(SERCOMM_KERNEL_OFFSET) \
		--rootfs-offset $(SERCOMM_ROOTFS_OFFSET) \
		--output-header $@.hdr
	dd if=$@ >> $@.hdr 2>/dev/null
	mv $@.hdr $@
endef

define Build/sercomm-kernel-factory
	$(TOPDIR)/scripts/sercomm-kernel-header.py \
		--kernel-image $(word 1,$(1)) \
		--kernel-offset $(SERCOMM_KERNEL_OFFSET) \
		--rootfs-offset $(SERCOMM_ROOTFS_OFFSET) \
		--rootfs-image $(word 2,$(1)) \
		--output-header $(word 1,$(1)).header1
	$(TOPDIR)/scripts/sercomm-kernel-header.py \
		--kernel-image $(word 1,$(1)) \
		--kernel-offset $(SERCOMM_KERNEL2_OFFSET) \
		--rootfs-offset $(SERCOMM_ROOTFS2_OFFSET) \
		--rootfs-image $(word 2,$(1)) \
		--output-header $(word 1,$(1)).header2
	cat $(word 1,$(1)).header1 $(word 1,$(1)).header2 > $(word 3,$(1))
endef

define Build/sercomm-kernel-trim
	dd if=$(word 1,$(1)) bs=512k | \
		{ dd bs=$$((0x100)) count=1 of=/dev/null; \
		  dd bs=512k of=$(word 2,$(1)); }
endef

define Build/sercomm-part-tag
	$(call Build/sercomm-part-tag-common,$(word 1,$(1)) $@)
endef

define Build/sercomm-part-tag-common
	$(eval file=$(word 2,$(1)))
	$(TOPDIR)/scripts/sercomm-partition-tag.py \
		--input-file $(file) \
		--output-file $(file).tmp \
		--part-name $(word 1,$(1)) \
		--part-version $(SERCOMM_SWVER)
	mv $(file).tmp $(file)
endef

define Build/sercomm-payload
	$(TOPDIR)/scripts/sercomm-pid.py \
		--hw-version $(SERCOMM_HWVER) \
		--hw-id $(SERCOMM_HWID) \
		--sw-version $(SERCOMM_SWVER) \
		--pid-file $@.pid \
		--extra-padding-size 0x10 \
		--extra-padding-first-byte 0x0a
	$(TOPDIR)/scripts/sercomm-payload.py \
		--input-file $@ \
		--output-file $@.tmp \
		--pid "$$(cat $@.pid | od -t x1 -An -v | tr -d '\n')"
	mv $@.tmp $@
	rm $@.pid
endef

define Build/sercomm-pid
	$(TOPDIR)/scripts/sercomm-pid.py \
		--hw-version $(SERCOMM_HWVER) \
		--hw-id $(SERCOMM_HWID) \
		--sw-version $(SERCOMM_SWVER) \
		--pid-file $(word 1,$(1))
endef

define Build/sercomm-pid-set0x10
	printf $(SERCOMM_0x10str) | dd seek=$$((0x10)) of=$@ bs=1 \
		conv=notrunc 2>/dev/null
endef

define Build/sercomm-prepend-tagged-kernel
	$(CP) $(IMAGE_KERNEL) $(IMAGE_KERNEL).tagged
	$(call Build/sercomm-part-tag-common,$(word 1,$(1)) \
		$(IMAGE_KERNEL).tagged)
	dd if=$@ >> $(IMAGE_KERNEL).tagged 2>/dev/null
	mv $(IMAGE_KERNEL).tagged $@
endef

define Build/sercomm-write-pid
	printf $$(stat -c%s $(word 1,$(1))) | dd seek=$(word 2,$(1)) \
		of=$(word 3,$(1)) bs=1 conv=notrunc 2>/dev/null
endef

define Device/sercomm
  $(Device/dsa-migration)
  BLOCKSIZE := 128k
  PAGESIZE := 2048
  UBINIZE_OPTS := -E 5
  LOADER_TYPE := bin
  KERNEL := kernel-bin | append-dtb | lzma | loader-kernel | lzma -a0 | \
	uImage lzma | sercomm-kernel
  KERNEL_INITRAMFS := kernel-bin | append-dtb | lzma | loader-kernel | \
	lzma -a0 | uImage lzma
  IMAGES += factory.img
  IMAGE/sysupgrade.bin := sysupgrade-tar | append-metadata
endef

define Device/sercomm_axx
  $(Device/sercomm)
  KERNEL_SIZE := 4096k
  SERCOMM_KERNEL_OFFSET := 0x1700100
  SERCOMM_ROOTFS_OFFSET := 0x1f00000
  SERCOMM_KERNEL2_OFFSET := 0x1b00100
endef

define Device/sercomm_cxx
  $(Device/sercomm)
  KERNEL_SIZE := 6144k
  KERNEL_LOADADDR := 0x81001000
  LZMA_TEXT_START := 0x82800000
  SERCOMM_KERNEL_OFFSET := 0x400100
  SERCOMM_ROOTFS_OFFSET := 0x1000000
  SERCOMM_KERNEL2_OFFSET := 0xa00100
  SERCOMM_ROOTFS2_OFFSET := 0x3000000
  IMAGE/factory.img := append-ubi | sercomm-factory-cqr
endef

define Device/sercomm_dxx
  $(Device/sercomm)
  KERNEL_SIZE := 6144k
  KERNEL_LOADADDR := 0x81001000
  LZMA_TEXT_START := 0x82800000
  SERCOMM_KERNEL_OFFSET := 0x400100
  SERCOMM_ROOTFS_OFFSET := 0x1000000
  IMAGE/factory.img := append-ubi | sercomm-part-tag rootfs | \
	sercomm-prepend-tagged-kernel kernel | gzip | sercomm-payload | \
	sercomm-crypto
endef
